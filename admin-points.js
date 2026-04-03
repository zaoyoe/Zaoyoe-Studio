/**
 * Admin Points Module - Redemption Batches and Package Catalog
 */

// Get supabase client (lazy load to ensure it's ready)
function getSupabase() {
    return window.supabaseClient || window.supabase;
}

const ADMIN_POINTS_HIDDEN_CLASS = 'admin-studio-inline-style-attr-3';
const ADMIN_POINTS_PANEL_VISIBLE_CLASS = 'admin-points-panel-visible';

function setAdminPointsVisibility(target, visible) {
    if (!target) return;
    target.classList.toggle(ADMIN_POINTS_HIDDEN_CLASS, !visible);
}

function setAdminPointsPanelVisible(target, visible) {
    if (!target) return;
    target.classList.toggle(ADMIN_POINTS_PANEL_VISIBLE_CLASS, visible);
}

function setAdminPointsRuntimeStyles(target, styles = {}, priority = '') {
    const style = target?.style;
    const setProperty = style?.['setProperty']?.bind(style);
    if (typeof setProperty !== 'function') {
        return;
    }

    Object.entries(styles).forEach(([name, value]) => {
        setProperty(name, String(value), priority);
    });
}

function syncPointsTabIndicator(indicator, activeTab) {
    if (!indicator || !activeTab) return;

    setAdminPointsRuntimeStyles(indicator, {
        '--admin-tab-indicator-width': `${activeTab.offsetWidth}px`,
        '--admin-tab-indicator-left': `${activeTab.offsetLeft}px`
    });
}

function hydratePointsUsageFills(scope = document) {
    scope.querySelectorAll('.usage-fill[data-usage-fill-width]').forEach((fill) => {
        setAdminPointsRuntimeStyles(fill, {
            '--points-usage-fill-width': fill.dataset.usageFillWidth || '0%'
        });
    });
}

function requireWritablePointsSite(options = {}) {
    return window.AdminSiteFilter?.requireWritableSite?.(options) || null;
}

function getPointsReadSite() {
    return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
}

function buildAdminPointsUrl(route, params = {}) {
    const url = new URL(`/api/admin/${route}`, window.location.origin);

    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });

    return `${url.pathname}${url.search}`;
}

async function parseAdminPointsResponse(response) {
    let payload = {};

    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }

    if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || `Points request failed (${response.status})`);
    }

    return payload;
}

let pointsCatalogSnapshot = null;
let pointsCatalogSite = '';
let pointsCatalogRows = [];
let pointsPackageEditorState = {
    mode: 'create',
    packageId: ''
};
let pointsPackageEditorInitialized = false;

function invalidatePointsCatalogSnapshot() {
    pointsCatalogSnapshot = null;
    pointsCatalogSite = '';
}

async function fetchPointsCatalogSnapshot({ site = getPointsReadSite(), force = false } = {}) {
    const normalizedSite = String(site || '').trim().toLowerCase() === 'intl'
        ? 'intl'
        : (String(site || '').trim().toLowerCase() === 'cn' ? 'cn' : 'all');

    if (!force && pointsCatalogSnapshot && pointsCatalogSite === normalizedSite) {
        return pointsCatalogSnapshot;
    }

    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPointsUrl('points/catalog', { site: normalizedSite }), {
        credentials: 'include'
    });
    const payload = await parseAdminPointsResponse(response);
    pointsCatalogSnapshot = payload;
    pointsCatalogSite = normalizedSite;
    return payload;
}

function buildEmptyPointsPackageMetrics() {
    return {
        cn: { batch_count: 0, generated_count: 0, used_count: 0 },
        intl: { batch_count: 0, generated_count: 0, used_count: 0 },
        total: { batch_count: 0, generated_count: 0, used_count: 0 }
    };
}

function normalizePointsCatalogPackageRow(row = {}) {
    const normalizedPoints = Math.max(0, Math.round(Number(row.points_amount) || 0));
    const normalizedBonus = Math.max(0, Math.round(Number(row.bonus_points) || 0));
    const normalizedPrice = row.price_cny == null || row.price_cny === ''
        ? null
        : Math.max(0, Math.round((Number(row.price_cny) || 0) * 100) / 100);
    const normalizedSort = Math.max(0, Math.round(Number(row.sort_order) || 0));

    return {
        ...row,
        id: String(row.id || '').trim(),
        name: String(row.name || '').trim(),
        name_en: String(row.name_en || '').trim(),
        points_amount: normalizedPoints,
        bonus_points: normalizedBonus,
        price_cny: normalizedPrice,
        is_active: row.is_active !== false,
        sort_order: normalizedSort,
        total_points: Math.max(0, Number(row.total_points) || 0) || (normalizedPoints + normalizedBonus),
        metrics: getPointsPackageMetrics(row)
    };
}

function setPointsCatalogRows(rows = []) {
    pointsCatalogRows = (Array.isArray(rows) ? rows : []).map(normalizePointsCatalogPackageRow);
    allPackages = pointsCatalogRows.map((row) => ({ ...row }));
    return pointsCatalogRows;
}

function getPointsCatalogRows() {
    return Array.isArray(pointsCatalogRows) ? pointsCatalogRows : [];
}

function getPointsPackageById(packageId = '') {
    const normalizedId = String(packageId || '').trim();
    return getPointsCatalogRows().find((row) => row.id === normalizedId) || null;
}

function getActivePointsPackageRow() {
    return getPointsPackageById(pointsPackageEditorState.packageId);
}

function getNextPointsPackageSortOrder(rows = getPointsCatalogRows()) {
    return rows.reduce((maxSort, row) => Math.max(maxSort, Number(row?.sort_order) || 0), 0) + 1;
}

function setPointsPackageEditorState(mode = 'create', packageId = '') {
    pointsPackageEditorState = {
        mode: mode === 'edit' ? 'edit' : 'create',
        packageId: String(packageId || '').trim()
    };
}

function getPointsPackageEditorElements() {
    return {
        form: document.getElementById('pointsPackageForm'),
        idInput: document.getElementById('pointsPackageId'),
        nameInput: document.getElementById('pointsPackageName'),
        nameEnInput: document.getElementById('pointsPackageNameEn'),
        basePointsInput: document.getElementById('pointsPackageBasePoints'),
        bonusPointsInput: document.getElementById('pointsPackageBonusPoints'),
        priceInput: document.getElementById('pointsPackagePrice'),
        sortInput: document.getElementById('pointsPackageSortOrder'),
        enabledInput: document.getElementById('pointsPackageEnabled'),
        modeBadge: document.getElementById('pointsPackageEditorModeBadge'),
        hint: document.getElementById('pointsPackageEditorHint'),
        metrics: document.getElementById('pointsPackageEditorMetrics'),
        saveBtn: document.getElementById('pointsPackageSaveBtn'),
        deleteBtn: document.getElementById('pointsPackageDeleteBtn')
    };
}

function setPointsPackageSaveButtonState(loading, text = '保存套餐') {
    const { saveBtn } = getPointsPackageEditorElements();
    if (!saveBtn) return;
    saveBtn.disabled = !!loading;
    saveBtn.innerHTML = loading
        ? '<i class="fas fa-spinner fa-spin"></i> 保存中...'
        : `<i class="fas fa-save"></i> ${text}`;
}

function renderBatchPackageFilterOptions(packages = []) {
    const popup = document.getElementById('batchPackagePopup');
    if (!popup) return;

    const existingOptions = popup.querySelectorAll('.filter-option:not([data-value="all"])');
    existingOptions.forEach((option) => option.remove());

    (Array.isArray(packages) ? packages : []).forEach((pkg) => {
        const opt = document.createElement('div');
        opt.className = 'filter-option';
        opt.dataset.value = pkg.id;
        opt.textContent = pkg.name;
        opt.onclick = () => filterBatchByPackage(pkg.id);
        popup.appendChild(opt);
    });
}

function getPointsPackageMetrics(pkg = {}) {
    const raw = pkg && typeof pkg.metrics === 'object' && pkg.metrics ? pkg.metrics : {};
    const normalizeMetric = (metric = {}) => ({
        batch_count: Math.max(0, Number(metric.batch_count) || 0),
        generated_count: Math.max(0, Number(metric.generated_count) || 0),
        used_count: Math.max(0, Number(metric.used_count) || 0)
    });

    return {
        cn: normalizeMetric(raw.cn),
        intl: normalizeMetric(raw.intl),
        total: normalizeMetric(raw.total)
    };
}

function formatPointsPackageMetricText(metric = {}) {
    return `批次 ${metric.batch_count} · 发码 ${metric.generated_count} · 已用 ${metric.used_count}`;
}

function formatPointsPackagePrice(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `¥${parsed.toFixed(2)}` : '-';
}

// ========================================
// GLOBAL UTILITY: Enable horizontal scroll with mouse wheel
// ========================================
function enableHorizontalScroll(container) {
    if (!container || container._horizontalScrollEnabled) return;

    container.addEventListener('wheel', (e) => {
        // Only intercept if content is wider than container (scrollable)
        if (container.scrollWidth > container.clientWidth) {
            e.preventDefault();
            container.scrollLeft += e.deltaY;
        }
    }, { passive: false });

    container._horizontalScrollEnabled = true; // Prevent duplicate listeners
}

// Make it globally available for other modules
window.enableHorizontalScroll = enableHorizontalScroll;

const POINTS_PREFETCH_VIEWS = ['batches', 'catalog', 'generate'];
let pointsViewPrefetchHandle = 0;
let pointsViewPrefetchMode = '';

// ========================================
// VIEW SWITCHING
// ========================================
function isPointsModuleActive() {
    const module = document.getElementById('module-points');
    return Boolean(module && module.classList.contains('active') && window.getComputedStyle(module).display !== 'none');
}

function getActivePointsViewName() {
    const activeView = document.querySelector('#module-points .view-section.active')?.id || '';
    return activeView.replace(/^points-view-/, '') || 'batches';
}

function clearPointsViewPrefetch() {
    if (!pointsViewPrefetchHandle) {
        return;
    }

    if (pointsViewPrefetchMode === 'idle' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(pointsViewPrefetchHandle);
    } else {
        window.clearTimeout(pointsViewPrefetchHandle);
    }

    pointsViewPrefetchHandle = 0;
    pointsViewPrefetchMode = '';
}

function prefetchPointsView(viewName) {
    const normalizedView = String(viewName || '').trim().toLowerCase();

    if (normalizedView === 'batches') {
        return loadBatches();
    }

    if (normalizedView === 'catalog') {
        return loadPointsPackageCatalog();
    }

    if (normalizedView === 'generate') {
        return Promise.all([
            loadPackagesForSelect(),
            Promise.resolve().then(() => initBatchExpiresPicker())
        ]);
    }

    return Promise.resolve(false);
}

function schedulePointsViewPrefetch(activeView = getActivePointsViewName()) {
    const normalizedView = String(activeView || 'batches').trim().toLowerCase();
    const siblingViews = POINTS_PREFETCH_VIEWS.filter((view) => view !== normalizedView);
    clearPointsViewPrefetch();

    if (!isPointsModuleActive() || siblingViews.length === 0) {
        return false;
    }

    const runPrefetch = async () => {
        pointsViewPrefetchHandle = 0;
        pointsViewPrefetchMode = '';

        if (!isPointsModuleActive()) {
            return;
        }

        for (const viewName of siblingViews) {
            if (!isPointsModuleActive()) {
                break;
            }

            try {
                await prefetchPointsView(viewName);
            } catch (error) {
                console.warn(`[AdminPoints] Failed to prefetch ${viewName} view:`, error);
            }
        }
    };

    if (typeof window.requestIdleCallback === 'function') {
        pointsViewPrefetchMode = 'idle';
        pointsViewPrefetchHandle = window.requestIdleCallback(runPrefetch, { timeout: 1200 });
        return true;
    }

    pointsViewPrefetchMode = 'timeout';
    pointsViewPrefetchHandle = window.setTimeout(runPrefetch, 280);
    return true;
}

function prefetchPointsModule() {
    return schedulePointsViewPrefetch(getActivePointsViewName());
}

function switchPointsView(viewName) {
    // Hide all views
    document.querySelectorAll('#module-points .view-section').forEach(v => {
        v.classList.remove('active');
    });

    // Show selected view
    const view = document.getElementById(`points-view-${viewName}`);
    if (view) view.classList.add('active');

    // Update tabs
    document.querySelectorAll('#module-points .admin-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.pointsView === viewName);
    });

    // Update tab indicator position
    const activeTab = document.querySelector('#module-points .admin-tab.active');
    const indicator = document.querySelector('#module-points .admin-tab-indicator');
    syncPointsTabIndicator(indicator, activeTab);

    // Load data for specific views
    if (viewName === 'batches') loadBatches();
    if (viewName === 'catalog') loadPointsPackageCatalog();
    if (viewName === 'generate') {
        loadPackagesForSelect();
        initBatchExpiresPicker(); // Initialize Flatpickr when switching to generate view
    }

    schedulePointsViewPrefetch(viewName);
}

window.switchPointsView = switchPointsView;
window.prefetchPointsModule = prefetchPointsModule;

// ========================================
// FLATPICKR INITIALIZATION
// ========================================
let batchExpiresPickerInstance = null;

function initBatchExpiresPicker() {
    const input = document.getElementById('batchExpires');
    if (!input || batchExpiresPickerInstance) return;

    // Check if Flatpickr is loaded
    if (typeof flatpickr === 'undefined') {
        console.warn('Flatpickr not loaded yet');
        return;
    }

    batchExpiresPickerInstance = flatpickr(input, {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        locale: "zh",
        allowInput: false,
        minDate: "today",
        // Theme based on current theme
        onOpen: function () {
            // Apply dark theme if needed
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const calendar = this.calendarContainer;
            if (isDark) {
                calendar.classList.add('flatpickr-dark-theme');
            } else {
                calendar.classList.remove('flatpickr-dark-theme');
            }
        }
    });
}

// ========================================
// LOAD BATCHES
// ========================================
let allBatches = [];
let filteredBatches = []; // Batches after applying filters
let selectedBatchIds = new Set();
let batchSelectMode = false;

// Sorting State
let batchSortField = 'created_at';
let batchSortOrder = 'desc'; // 'asc' or 'desc'

// Filtering State
let batchChannelFilterValue = 'all';
let batchPackageFilterValue = 'all';

// Flag to prevent filter during code search
let isCodeSearchInProgress = false;

// Pagination State
let batchCurrentPage = 1;
const batchPageSize = 10;

// All available packages (for filter dropdown)
let allPackages = [];

function buildPointsBatchLoadingSkeleton(rowCount = 6) {
    const rows = Math.max(4, Number.parseInt(rowCount, 10) || 6);
    return Array.from({ length: rows }, (_, index) => `
        <tr class="admin-table-skeleton-row" aria-hidden="true" data-skeleton-index="${index}">
            <td>
                <div class="admin-table-skeleton-cell">
                    <span class="admin-skeleton-block admin-skeleton-block--checkbox"></span>
                </div>
            </td>
            <td>
                <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                    <span class="admin-skeleton-block admin-skeleton-block--title" style="width:${42 + (index % 3) * 12}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${30 + (index % 2) * 12}%"></span>
                </div>
            </td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--pill" style="width:92px"></span></div></td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--pill" style="width:76px"></span></div></td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--line" style="width:52px"></span></div></td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--line" style="width:48px"></span></div></td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--line" style="width:116px"></span></div></td>
            <td>
                <div class="admin-table-skeleton-cell admin-table-skeleton-actions">
                    <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadBatches() {
    const tbody = document.getElementById('batchesTableBody');
    tbody.innerHTML = buildPointsBatchLoadingSkeleton();

    try {
        const currentSite = getPointsReadSite();
        const payload = await fetchPointsBatchesPayload({ site: currentSite });
        allBatches = Array.isArray(payload?.batches) ? payload.batches : [];

        // Also load packages for filter dropdown (if not already loaded)
        if (allPackages.length === 0) {
            await loadPackagesForFilter();
        }

        applyBatchFilters();

        // Enable horizontal scroll with mouse wheel (like users module)
        initBatchTableHorizontalScroll();

    } catch (err) {
        console.error('Failed to load batches:', err);
        tbody.innerHTML = `<tr><td colspan="8" class="error-cell">加载失败: ${err.message}</td></tr>`;
    }
}

// Enable horizontal scroll with mouse wheel on the batch table
function initBatchTableHorizontalScroll() {
    const tablePanel = document.querySelector('#points-view-batches .glass-panel.users-table-panel');
    enableHorizontalScroll(tablePanel);
}

// Load packages for filter dropdown
async function loadPackagesForFilter() {
    try {
        const payload = await fetchPointsCatalogSnapshot();
        allPackages = Array.isArray(payload?.packages) ? payload.packages : [];
        renderBatchPackageFilterOptions(allPackages);
    } catch (err) {
        console.error('Failed to load packages for filter:', err);
    }
}

function renderBatches() {
    const tbody = document.getElementById('batchesTableBody');
    const colCount = batchSelectMode ? 8 : 7;

    if (filteredBatches.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-cell">暂无批次</td></tr>`;
        updatePaginationUI();
        return;
    }

    const channelLabels = {
        xianyu: '闲鱼',
        taobao: '淘宝',
        manual: '手动',
        promotion: '促销',
        test: '测试'
    };

    // Apply pagination
    const start = (batchCurrentPage - 1) * batchPageSize;
    const end = start + batchPageSize;
    const pageBatches = filteredBatches.slice(start, end);

    tbody.innerHTML = pageBatches.map(batch => {
        const pkg = batch.points_packages;
        const usedPercent = batch.total_count > 0 ? Math.round((batch.used_count / batch.total_count) * 100) : 0;
        const createdAt = new Date(batch.created_at).toLocaleString('zh-CN', {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const isSelected = selectedBatchIds.has(batch.id);
        const checkboxCell = batchSelectMode ? `
            <td class="checkbox-col" data-points-action="batch-row-stop">
                <label class="custom-checkbox">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} data-points-change="toggle-selection" data-batch-id="${encodeURIComponent(batch.id)}">
                    <span class="checkmark"></span>
                </label>
            </td>
        ` : '';

        return `
            <tr data-batch-id="${batch.id}" class="points-batch-row ${isSelected ? 'selected' : ''}" data-points-action="view-batch-codes">
                ${checkboxCell}
                <td><strong>${batch.name}</strong></td>
                <td>${pkg?.name || '-'}</td>
                <td><span class="channel-badge ${batch.channel}">${channelLabels[batch.channel] || batch.channel}</span></td>
                <td>${batch.total_count}</td>
                <td>
                    <div class="usage-cell">
                        <span>${batch.used_count}</span>
                        <div class="usage-bar"><div class="usage-fill" data-usage-fill-width="${usedPercent}%"></div></div>
                    </div>
                </td>
                <td>${createdAt}</td>
                <td class="actions-cell" data-points-action="batch-row-stop">
                    <button class="btn-icon" type="button" data-points-action="open-batch-edit" data-batch-id="${encodeURIComponent(batch.id)}" title="编辑批次">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon" type="button" data-points-action="export-batch-codes" data-batch-id="${encodeURIComponent(batch.id)}" title="导出Excel">
                        <i class="fas fa-download"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    hydratePointsUsageFills(tbody);
    updatePaginationUI();
    updateSelectAllCheckbox();
}

function buildPointsCatalogSummaryCard(iconClass, label, value, tone = 'default') {
    return `
        <article class="points-catalog-summary-card points-catalog-summary-card--${tone}">
            <div class="points-catalog-summary-card__icon"><i class="${iconClass}"></i></div>
            <div class="points-catalog-summary-card__body">
                <div class="points-catalog-summary-card__label">${label}</div>
                <div class="points-catalog-summary-card__value">${value}</div>
            </div>
        </article>
    `;
}

function updatePointsPackageTableSelection() {
    const tbody = document.getElementById('pointsPackagesTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr[data-package-id]').forEach((row) => {
        row.classList.toggle('is-selected', row.getAttribute('data-package-id') === pointsPackageEditorState.packageId);
    });
}

function renderPointsPackageEditor() {
    const {
        idInput,
        nameInput,
        nameEnInput,
        basePointsInput,
        bonusPointsInput,
        priceInput,
        sortInput,
        enabledInput,
        modeBadge,
        hint,
        metrics,
        deleteBtn
    } = getPointsPackageEditorElements();

    if (!nameInput || !basePointsInput) {
        return;
    }

    const row = getActivePointsPackageRow();
    const isEditMode = pointsPackageEditorState.mode === 'edit' && !!row;
    const source = row || {
        id: '',
        name: '',
        name_en: '',
        points_amount: 100,
        bonus_points: 0,
        price_cny: null,
        is_active: true,
        sort_order: getNextPointsPackageSortOrder(),
        metrics: buildEmptyPointsPackageMetrics()
    };
    const metricsValue = getPointsPackageMetrics(source);

    if (idInput) idInput.value = source.id || '';
    nameInput.value = source.name || '';
    if (nameEnInput) nameEnInput.value = source.name_en || '';
    basePointsInput.value = String(Math.max(0, Number(source.points_amount) || 0));
    if (bonusPointsInput) bonusPointsInput.value = String(Math.max(0, Number(source.bonus_points) || 0));
    if (priceInput) priceInput.value = source.price_cny == null ? '' : String(source.price_cny);
    if (sortInput) sortInput.value = String(Math.max(0, Number(source.sort_order) || 0));
    if (enabledInput) enabledInput.checked = source.is_active !== false;

    if (modeBadge) {
        modeBadge.textContent = isEditMode ? '编辑中' : '新建';
    }

    if (hint) {
        hint.textContent = isEditMode
            ? `当前编辑：${source.name || '未命名套餐'}${source.id ? ` · ID ${source.id}` : ''}`
            : '创建一条新的全局套餐。保存时仍要求你先在顶部站点筛选中选择 cn 或 intl。';
    }

    if (metrics) {
        metrics.innerHTML = `
            <div class="points-package-editor-metric">
                <span class="label">CN 运营表现</span>
                <span class="value">${formatPointsPackageMetricText(metricsValue.cn)}</span>
            </div>
            <div class="points-package-editor-metric">
                <span class="label">INTL 运营表现</span>
                <span class="value">${formatPointsPackageMetricText(metricsValue.intl)}</span>
            </div>
        `;
    }

    if (deleteBtn) {
        deleteBtn.disabled = !isEditMode;
    }

    setPointsPackageSaveButtonState(false, isEditMode ? '保存套餐' : '创建套餐');
    updatePointsPackageTableSelection();
}

function startNewPointsPackage() {
    setPointsPackageEditorState('create', '');
    renderPointsPackageEditor();
    document.getElementById('pointsPackageName')?.focus();
}

function openPointsPackageEditor(packageId = '') {
    const row = getPointsPackageById(packageId);
    if (!row) return;
    setPointsPackageEditorState('edit', row.id);
    renderPointsPackageEditor();
}

function resetPointsPackageEditor() {
    if (pointsPackageEditorState.mode === 'edit' && getActivePointsPackageRow()) {
        renderPointsPackageEditor();
        return;
    }
    startNewPointsPackage();
}

function collectPointsPackageFormPayload() {
    const {
        nameInput,
        nameEnInput,
        basePointsInput,
        bonusPointsInput,
        priceInput,
        sortInput,
        enabledInput
    } = getPointsPackageEditorElements();

    const name = String(nameInput?.value || '').trim();
    if (!name) {
        throw new Error('请先填写套餐名称');
    }

    const pointsAmount = Math.max(0, Math.round(Number(basePointsInput?.value) || 0));
    if (pointsAmount <= 0) {
        throw new Error('基础积分需要大于 0');
    }

    const bonusPoints = Math.max(0, Math.round(Number(bonusPointsInput?.value) || 0));
    const sortOrder = Math.max(0, Math.round(Number(sortInput?.value) || 0));
    const rawPrice = String(priceInput?.value || '').trim();
    const normalizedPrice = rawPrice
        ? Math.max(0, Math.round((Number(rawPrice) || 0) * 100) / 100)
        : null;

    return {
        name,
        name_en: String(nameEnInput?.value || '').trim(),
        points: pointsAmount,
        bonus: bonusPoints,
        price: normalizedPrice,
        sort: sortOrder,
        enabled: enabledInput?.checked !== false
    };
}

function setPointsPackageSaveButtonState(loading, text = '保存套餐') {
    const { saveBtn } = getPointsPackageEditorElements();
    if (!saveBtn) return;
    saveBtn.disabled = !!loading;
    saveBtn.innerHTML = loading
        ? '<i class="fas fa-spinner fa-spin"></i> 保存中...'
        : `<i class="fas fa-save"></i> ${text}`;
}

async function mutatePointsPackage({ action = 'update', id = '', payload = {}, label = '保存套餐', method = 'POST' } = {}) {
    const writableSite = requireWritablePointsSite({ label });
    if (!writableSite) {
        return null;
    }

    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPointsUrl('points/packages'), {
        method,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(method === 'DELETE'
            ? { id, site: writableSite }
            : {
                action,
                id,
                site: writableSite,
                ...(payload && typeof payload === 'object' ? payload : {})
            })
    });

    return parseAdminPointsResponse(response);
}

async function mutatePointsManage({ action = '', site = '', payload = {} } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPointsUrl('points/manage'), {
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

    return parseAdminPointsResponse(response);
}

async function fetchPointsBatchesPayload(params = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPointsUrl('points/batches', params), {
        credentials: 'include'
    });
    return parseAdminPointsResponse(response);
}

async function fetchPointsLookupPayload(params = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPointsUrl('points/lookup', params), {
        credentials: 'include'
    });
    return parseAdminPointsResponse(response);
}

async function reloadPointsCatalogAfterMutation({ nextMode = 'edit', nextPackageId = '' } = {}) {
    invalidatePointsCatalogSnapshot();
    const payload = await fetchPointsCatalogSnapshot({ site: getPointsReadSite(), force: true });
    const rows = Array.isArray(payload?.packages) ? payload.packages : [];
    const hasNextPackage = rows.some((row) => String(row?.id || '') === String(nextPackageId || ''));

    if (nextMode === 'create') {
        setPointsPackageEditorState('create', '');
    } else if (hasNextPackage) {
        setPointsPackageEditorState('edit', nextPackageId);
    } else if (rows.length > 0) {
        setPointsPackageEditorState('edit', rows[0].id);
    } else {
        setPointsPackageEditorState('create', '');
    }

    renderPointsPackageCatalog(payload);
    return payload;
}

async function savePointsPackageForm(event) {
    event.preventDefault();

    try {
        const payload = collectPointsPackageFormPayload();
        const isCreate = pointsPackageEditorState.mode !== 'edit' || !pointsPackageEditorState.packageId;
        setPointsPackageSaveButtonState(true, isCreate ? '创建套餐' : '保存套餐');

        const result = await mutatePointsPackage({
            action: isCreate ? 'create' : 'update',
            id: pointsPackageEditorState.packageId,
            payload,
            label: isCreate ? '创建套餐' : '保存套餐'
        });

        if (!result) {
            return;
        }

        await reloadPointsCatalogAfterMutation({
            nextMode: 'edit',
            nextPackageId: result.row?.id || pointsPackageEditorState.packageId
        });

        if (typeof showToast === 'function') {
            showToast(isCreate ? '套餐已创建' : '套餐已保存', 'success');
        }
    } catch (error) {
        console.error('Failed to save points package:', error);
        if (typeof showToast === 'function') {
            showToast(`保存套餐失败: ${error.message}`, 'error');
        }
    } finally {
        setPointsPackageSaveButtonState(false, '保存套餐');
    }
}

async function deleteCurrentPointsPackage() {
    const row = getActivePointsPackageRow();
    if (!row) return;

    if (!confirm(`确定删除套餐「${row.name || '未命名套餐'}」吗？`)) {
        return;
    }

    try {
        const result = await mutatePointsPackage({
            method: 'DELETE',
            id: row.id,
            label: '删除套餐'
        });

        if (!result) {
            return;
        }

        await reloadPointsCatalogAfterMutation({ nextMode: 'create' });
        if (typeof showToast === 'function') {
            showToast('套餐已删除', 'success');
        }
    } catch (error) {
        console.error('Failed to delete points package:', error);
        if (typeof showToast === 'function') {
            showToast(`删除套餐失败: ${error.message}`, 'error');
        }
    }
}

function renderPointsPackageCatalog(payload = {}) {
    const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const packages = setPointsCatalogRows(Array.isArray(payload?.packages) ? payload.packages : []);
    const summaryEl = document.getElementById('pointsCatalogSummary');
    const tbody = document.getElementById('pointsPackagesTableBody');
    const currentSite = getPointsReadSite();
    renderBatchPackageFilterOptions(allPackages);

    if (summaryEl) {
        summaryEl.innerHTML = [
            buildPointsCatalogSummaryCard('fas fa-box-open', '套餐总数', summary.package_count || 0, 'blue'),
            buildPointsCatalogSummaryCard('fas fa-check-circle', '启用套餐', summary.active_package_count || 0, 'green'),
            buildPointsCatalogSummaryCard('fas fa-layer-group', currentSite === 'all' ? '全部批次' : `${currentSite.toUpperCase()} 批次`, summary.batch_count || 0, 'amber'),
            buildPointsCatalogSummaryCard('fas fa-ticket-alt', currentSite === 'all' ? '已发兑换码' : `${currentSite.toUpperCase()} 发码`, summary.generated_code_count || 0, 'violet'),
            buildPointsCatalogSummaryCard('fas fa-bolt', currentSite === 'all' ? '已使用兑换码' : `${currentSite.toUpperCase()} 已用`, summary.used_code_count || 0, 'rose'),
            buildPointsCatalogSummaryCard('fas fa-pen-ruler', '自定义批次', summary.custom_batch_count || 0, 'slate')
        ].join('');
    }

    if (!tbody) return;

    if (!packages.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">暂无套餐目录</td></tr>';
        setPointsPackageEditorState('create', '');
        renderPointsPackageEditor();
        return;
    }

    if (!pointsPackageEditorInitialized) {
        setPointsPackageEditorState('edit', packages[0].id);
        pointsPackageEditorInitialized = true;
    } else if (pointsPackageEditorState.mode === 'edit' && !getActivePointsPackageRow()) {
        setPointsPackageEditorState('edit', packages[0].id);
    }

    tbody.innerHTML = packages.map((pkg) => {
        const metrics = getPointsPackageMetrics(pkg);
        const statusClass = pkg.is_active === false ? 'is-inactive' : 'is-active';
        const secondaryName = String(pkg.name_en || '').trim();
        const totalPoints = Math.max(0, Number(pkg.total_points) || 0);
        const isSelected = pointsPackageEditorState.packageId === pkg.id;

        return `
            <tr class="points-package-row ${isSelected ? 'is-selected' : ''}" data-package-id="${pkg.id}">
                <td>
                    <div class="points-package-name">
                        <strong>${pkg.name || '-'}</strong>
                        ${secondaryName ? `<span class="points-package-name__secondary">${secondaryName}</span>` : ''}
                    </div>
                </td>
                <td>
                    <div class="points-package-balance">
                        <strong>${totalPoints}</strong>
                        <span>基础 ${pkg.points_amount || 0} / 赠送 ${pkg.bonus_points || 0}</span>
                    </div>
                </td>
                <td>${formatPointsPackagePrice(pkg.price_cny)}</td>
                <td><span class="points-package-status ${statusClass}">${pkg.is_active === false ? '停用' : '启用'}</span></td>
                <td class="points-package-metric-cell">${formatPointsPackageMetricText(metrics.cn)}</td>
                <td class="points-package-metric-cell">${formatPointsPackageMetricText(metrics.intl)}</td>
                <td class="points-package-actions">
                    <button class="btn-icon" type="button" data-points-action="edit-package" data-package-id="${encodeURIComponent(pkg.id)}" title="编辑套餐">
                        <i class="fas fa-pen"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    renderPointsPackageEditor();
}

async function loadPointsPackageCatalog({ force = false } = {}) {
    const summaryEl = document.getElementById('pointsCatalogSummary');
    const tbody = document.getElementById('pointsPackagesTableBody');

    if (summaryEl) {
        summaryEl.innerHTML = [
            buildPointsCatalogSummaryCard('fas fa-box-open', '套餐总数', '...', 'blue'),
            buildPointsCatalogSummaryCard('fas fa-check-circle', '启用套餐', '...', 'green'),
            buildPointsCatalogSummaryCard('fas fa-layer-group', '批次', '...', 'amber')
        ].join('');
    }
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">正在加载套餐目录...</td></tr>';
    }

    try {
        const payload = await fetchPointsCatalogSnapshot({ site: getPointsReadSite(), force });
        renderPointsPackageCatalog(payload);
    } catch (error) {
        console.error('Failed to load points package catalog:', error);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="error-cell">加载套餐目录失败: ${error.message}</td></tr>`;
        }
    }
}

// ========================================
// LOAD PACKAGES FOR SELECT
// ========================================
async function loadPackagesForSelect() {
    const optionsContainer = document.getElementById('packageOptions');
    const displayText = document.querySelector('#packageSelectDropdown .select-text');
    const hiddenInput = document.getElementById('batchPackageId');

    if (!optionsContainer) return;

    displayText.textContent = '加载中...';

    try {
        const payload = await fetchPointsCatalogSnapshot();
        const packages = (Array.isArray(payload?.packages) ? payload.packages : [])
            .filter((pkg) => pkg.is_active !== false);

        // Build options with custom option at the end
        let optionsHtml = packages.map((pkg, index) => {
            const total = pkg.points_amount + (pkg.bonus_points || 0);
            const isFirst = index === 0;
            return `<div class="select-option${isFirst ? ' selected' : ''}" data-value="${pkg.id}">${pkg.name} (${total}分)</div>`;
        }).join('');

        // Add custom points option
        optionsHtml += `<div class="select-option custom-option" data-value="custom">✏️ 自定义积分</div>`;

        optionsContainer.innerHTML = optionsHtml;

        // Select first option by default
        if (packages.length > 0) {
            const firstPkg = packages[0];
            const total = firstPkg.points_amount + (firstPkg.bonus_points || 0);
            displayText.textContent = `${firstPkg.name} (${total}分)`;
            hiddenInput.value = firstPkg.id;
        } else {
            displayText.textContent = '暂无套餐';
        }

        // Hide custom input initially
        const customInputWrapper = document.getElementById('customPointsWrapper');
        setAdminPointsVisibility(customInputWrapper, false);

        // Initialize dropdown handlers
        initPointsDropdowns();

    } catch (err) {
        console.error('Failed to load packages:', err);
        displayText.textContent = '加载失败';
    }
}

// ========================================
// CUSTOM DROPDOWN HANDLERS
// ========================================
function initPointsDropdowns() {
    const dropdowns = document.querySelectorAll('#module-points .points-select');

    dropdowns.forEach(dropdown => {
        const display = dropdown.querySelector('.select-display');
        const options = dropdown.querySelector('.select-options');
        const hiddenInput = dropdown.querySelector('input[type="hidden"]');
        const displayText = dropdown.querySelector('.select-text');

        // Toggle dropdown on click
        display.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close all other dropdowns
            dropdowns.forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });

        // Handle option selection
        options.querySelectorAll('.select-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const text = option.textContent;

                // Update display
                displayText.textContent = text;
                hiddenInput.value = value;

                // Update selected state
                options.querySelectorAll('.select-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');

                // Handle custom points option
                const customWrapper = document.getElementById('customPointsWrapper');
                if (dropdown.id === 'packageSelectDropdown' && customWrapper) {
                    if (value === 'custom') {
                        setAdminPointsVisibility(customWrapper, true);
                        // Focus the input
                        setTimeout(() => {
                            document.getElementById('customPointsAmount')?.focus();
                        }, 100);
                    } else {
                        setAdminPointsVisibility(customWrapper, false);
                    }
                }

                // Close dropdown
                dropdown.classList.remove('open');
            });
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        dropdowns.forEach(d => d.classList.remove('open'));
    });
}

// ========================================
// GENERATE CODES
// ========================================
let generatedCodes = [];

async function generateCodes(event) {
    event.preventDefault();

    const currentSite = requireWritablePointsSite({ formId: 'generateCodesForm' });
    if (!currentSite) {
        return;
    }

    const batchName = document.getElementById('batchName').value.trim();
    const packageIdValue = document.getElementById('batchPackageId').value;
    const count = parseInt(document.getElementById('batchCount').value);
    const channel = document.getElementById('batchChannel').value;
    const expiresInput = document.getElementById('batchExpires').value;
    const expiresAt = expiresInput ? new Date(expiresInput).toISOString() : null;

    // Check if using custom points
    const isCustomPoints = packageIdValue === 'custom';
    let customPointsAmount = null;

    if (isCustomPoints) {
        customPointsAmount = parseInt(document.getElementById('customPointsAmount')?.value);
        if (!customPointsAmount || customPointsAmount <= 0) {
            alert('请输入有效的自定义积分数量');
            return;
        }
    }

    if (!batchName || (!isCustomPoints && !packageIdValue) || !count) {
        alert('请填写所有必填项');
        return;
    }

    const btn = event.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
    btn.disabled = true;

    try {
        const payload = await mutatePointsManage({
            action: 'generate_codes',
            site: currentSite,
            payload: {
                batch_name: batchName,
                package_id: isCustomPoints ? null : packageIdValue,
                custom_points_amount: isCustomPoints ? customPointsAmount : null,
                count,
                channel,
                expires_at: expiresAt
            }
        });

        generatedCodes = Array.isArray(payload?.codes) ? payload.codes : [];
        displayGeneratedCodes();
        invalidatePointsCatalogSnapshot();

    } catch (err) {
        console.error('Failed to generate codes:', err);
        alert('生成失败: ' + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function displayGeneratedCodes() {
    const resultDiv = document.getElementById('generatedCodesResult');
    const codesList = document.getElementById('codesListDisplay');

    codesList.innerHTML = generatedCodes.map(code =>
        `<div class="code-item" data-points-action="copy-code-item" data-code="${encodeURIComponent(code)}" title="点击复制"><code>${code}</code></div>`
    ).join('');

    // Update display logic for 2-column layout
    const placeholder = document.getElementById('generatePlaceholder');
    setAdminPointsVisibility(placeholder, false);

    setAdminPointsPanelVisible(resultDiv, true);
}

// Copy single code to clipboard
function copySingleCode(element, code) {
    navigator.clipboard.writeText(code).then(() => {
        element.classList.add('copied');
        setTimeout(() => element.classList.remove('copied'), 1500);
    });
}

function bindAdminPointsRuntimeDelegates() {
    if (document.documentElement.dataset.adminPointsRuntimeDelegatesBound === '1') {
        return;
    }

    document.documentElement.dataset.adminPointsRuntimeDelegatesBound = '1';

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        if (target.matches('[data-points-overlay-close="delete-options"]')) {
            closeDeleteOptionsModal();
            return;
        }

        if (target.matches('[data-points-overlay-close="codes"]')) {
            closeCodesModal();
            return;
        }

        if (target.matches('[data-points-overlay-close="batch-edit"]')) {
            closeBatchEditModal();
            return;
        }

        const actionEl = target.closest('[data-points-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.pointsAction) {
            case 'batch-row-stop':
                event.stopPropagation();
                break;
            case 'new-package':
                startNewPointsPackage();
                break;
            case 'reset-package-editor':
                resetPointsPackageEditor();
                break;
            case 'edit-package':
                openPointsPackageEditor(decodeURIComponent(actionEl.dataset.packageId || ''));
                break;
            case 'delete-current-package':
                deleteCurrentPointsPackage();
                break;
            case 'view-batch-codes':
                viewBatchCodes(actionEl.dataset.batchId || actionEl.getAttribute('data-batch-id') || '');
                break;
            case 'open-batch-edit':
                event.stopPropagation();
                openBatchEditModal(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'export-batch-codes':
                event.stopPropagation();
                exportBatchCodes(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'copy-code-item':
                copySingleCode(actionEl, decodeURIComponent(actionEl.dataset.code || ''));
                break;
            case 'go-batch-page':
                goToBatchPage(Number(actionEl.dataset.page || 0));
                break;
            case 'close-delete-options':
                closeDeleteOptionsModal();
                break;
            case 'execute-delete-option':
                executeDeleteWithOption(decodeURIComponent(actionEl.dataset.batchIds || ''));
                break;
            case 'close-codes-modal':
                closeCodesModal();
                break;
            case 'navigate-user':
                navigateToUser(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'set-code-expiry':
                setCodeExpiry(
                    decodeURIComponent(actionEl.dataset.code || ''),
                    decodeURIComponent(actionEl.dataset.codeExpiry || '')
                );
                break;
            case 'disable-code':
                disableCode(decodeURIComponent(actionEl.dataset.code || ''));
                break;
            case 'revoke-code':
                revokeCode(decodeURIComponent(actionEl.dataset.code || ''));
                break;
            case 'enable-code':
                enableCode(decodeURIComponent(actionEl.dataset.code || ''));
                break;
            case 'close-batch-edit':
                closeBatchEditModal();
                break;
            case 'navigate-batch':
                event.preventDefault();
                navigateToBatch(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
        }
    });

    document.addEventListener('change', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-points-change]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.pointsChange) {
            case 'toggle-selection':
                toggleBatchSelection(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
        }
    });

    document.addEventListener('submit', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const form = target?.closest('[data-points-submit]');
        if (!form) {
            return;
        }

        switch (form.dataset.pointsSubmit) {
            case 'save-package':
                savePointsPackageForm(event);
                break;
            case 'save-batch-edit':
                saveBatchEdit(event, decodeURIComponent(form.dataset.batchId || ''));
                break;
        }
    });
}

bindAdminPointsRuntimeDelegates();

// Search Filter Listener
let codeSearchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    const initPointsPageBindings = () => {
        const searchInput = document.getElementById('batchSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                // Skip filtering if we're clearing input after code search
                if (isCodeSearchInProgress) return;

                const term = e.target.value.trim().toUpperCase();

                // Check if it looks like a complete redemption code (ZY-XXXX-XXXX-XXXX format)
                const isCodeFormat = /^ZY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(term);

                if (isCodeFormat) {
                    // Debounce code search to avoid too many API calls
                    clearTimeout(codeSearchDebounceTimer);
                    codeSearchDebounceTimer = setTimeout(() => {
                        searchCodeInBatchesNoModal(term);
                    }, 300);
                } else if (term.startsWith('ZY-')) {
                    // Partial code input - show loading hint or wait
                    // Don't filter yet, wait for complete code
                } else {
                    // Regular batch name filter
                    clearTimeout(codeSearchDebounceTimer);
                    applyBatchFilters();
                }
            });
        }

        // Initialize batch date pickers for custom range
        initBatchDatePickers();

        // Close all batch filter dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            const filterIds = ['batchDateFilter', 'batchChannelFilter', 'batchPackageFilter', 'batchExportDropdown'];
            filterIds.forEach(id => {
                const filter = document.getElementById(id);
                if (filter && !filter.contains(e.target)) {
                    filter.classList.remove('open');
                }
            });

            // Also close export popup (uses .show class)
            const exportPopup = document.getElementById('batchExportPopup');
            const exportDropdown = document.getElementById('batchExportDropdown');
            if (exportPopup && exportDropdown && !exportDropdown.contains(e.target)) {
                exportPopup.classList.remove('show');
            }
        });
    };

    if (window.adminStudioAccessGranted) {
        initPointsPageBindings();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initPointsPageBindings, { once: true });
});

// ========================================
// BATCH DATE FILTER
// ========================================
let batchDateFilterValue = 'all';
let batchCustomDateFrom = null;
let batchCustomDateTo = null;

// Helper: Position fixed popup for mobile
function positionMobilePopup(filterElement) {
    if (window.innerWidth > 768) return; // Desktop uses absolute positioning
    const btn = filterElement.querySelector('.filter-btn');
    // Also support glass-popup (used by export dropdown)
    const popup = filterElement.querySelector('.filter-popup') || filterElement.querySelector('.glass-popup');
    if (btn && popup) {
        const rect = btn.getBoundingClientRect();
        const parentRect = filterElement.getBoundingClientRect();
        const popupWidth = popup.offsetWidth || 180; // use actual width or estimate
        let left = rect.right - parentRect.left - popupWidth; // align right edge of popup with right edge of button
        if (left < 12) left = 12;
        const maxLeft = Math.max(parentRect.width - popupWidth - 12, 12);
        if (left > maxLeft) {
            left = maxLeft;
        }

        setAdminPointsRuntimeStyles(filterElement, {
            '--popup-top': `${btn.offsetTop + btn.offsetHeight + 4}px`,
            '--popup-left': `${left}px`
        });
    }
}

function toggleBatchDateFilter() {
    const filter = document.getElementById('batchDateFilter');
    const wasOpen = filter.classList.contains('open');
    closeAllBatchDropdowns();
    if (!wasOpen) {
        filter.classList.add('open');
        positionMobilePopup(filter);
    }
}

function filterBatchByDate(value) {
    batchDateFilterValue = value;

    // Update label
    const labels = { all: '日期', today: '今天', week: '本周', month: '本月' };
    document.getElementById('batchDateLabel').textContent = labels[value] || '日期';

    // Update selected class
    document.querySelectorAll('#batchDatePopup .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Close dropdown
    document.getElementById('batchDateFilter').classList.remove('open');

    // Apply filter
    applyBatchFilters();
}

function applyBatchFilters() {
    const searchTerm = document.getElementById('batchSearchInput')?.value.toLowerCase() || '';

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Filter batches
    filteredBatches = allBatches.filter(batch => {
        // Text search
        const matchesSearch = batch.name.toLowerCase().includes(searchTerm);

        // Date filter
        let matchesDate = true;
        const createdAt = new Date(batch.created_at);

        switch (batchDateFilterValue) {
            case 'today':
                matchesDate = createdAt >= startOfDay;
                break;
            case 'week':
                matchesDate = createdAt >= startOfWeek;
                break;
            case 'month':
                matchesDate = createdAt >= startOfMonth;
                break;
            case 'custom':
                if (batchCustomDateFrom) matchesDate = createdAt >= batchCustomDateFrom;
                if (batchCustomDateTo && matchesDate) matchesDate = createdAt <= batchCustomDateTo;
                break;
        }

        // Channel filter
        const matchesChannel = batchChannelFilterValue === 'all' || batch.channel === batchChannelFilterValue;

        // Package filter
        const matchesPackage = batchPackageFilterValue === 'all' ||
            (batch.points_packages?.id === batchPackageFilterValue);

        return matchesSearch && matchesDate && matchesChannel && matchesPackage;
    });

    // Sort batches
    filteredBatches.sort((a, b) => {
        let aVal, bVal;

        switch (batchSortField) {
            case 'name':
                aVal = a.name.toLowerCase();
                bVal = b.name.toLowerCase();
                break;
            case 'total_count':
                aVal = a.total_count;
                bVal = b.total_count;
                break;
            case 'used_count':
                aVal = a.used_count;
                bVal = b.used_count;
                break;
            case 'created_at':
            default:
                aVal = new Date(a.created_at).getTime();
                bVal = new Date(b.created_at).getTime();
                break;
        }

        if (aVal < bVal) return batchSortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return batchSortOrder === 'asc' ? 1 : -1;
        return 0;
    });

    // Reset to first page when filters change
    batchCurrentPage = 1;

    renderBatches();
}

// Search for redemption code and navigate to its batch
async function searchCodeInBatches() {
    const searchInput = document.getElementById('batchSearchInput');
    const searchTerm = searchInput?.value.trim().toUpperCase();
    const currentSite = getPointsReadSite();

    if (!searchTerm) return;

    // Check if it looks like a redemption code (ZY- prefix)
    if (!searchTerm.startsWith('ZY-')) {
        // Regular batch name search - just apply filters
        applyBatchFilters();
        return;
    }

    // It's a redemption code - search in database
    try {
        const payload = await fetchPointsBatchesPayload({ site: currentSite, code: searchTerm });

        if (payload?.batch) {
            // Found the code - display only this batch in the table
            isCodeSearchInProgress = true;

            // Override the filtered batches to show only this batch
            filteredBatches = [payload.batch];
            batchCurrentPage = 1;
            renderBatches();

            isCodeSearchInProgress = false;

            // Then open its batch details modal
            viewBatchCodes(payload.batch.id);
        } else {
            alert('❌ 未找到该兑换码，请检查输入是否正确');
        }
    } catch (err) {
        console.error('Code search failed:', err);
        alert('搜索失败: ' + err.message);
    }
}

// Search for code without opening modal (for real-time input search)
async function searchCodeInBatchesNoModal(code) {
    try {
        const payload = await fetchPointsBatchesPayload({ site: getPointsReadSite(), code });

        if (payload?.batch) {
            // Found the code - display only this batch in the table
            isCodeSearchInProgress = true;

            filteredBatches = [payload.batch];
            batchCurrentPage = 1;
            renderBatches();

            isCodeSearchInProgress = false;
        } else {
            // Code not found - show empty state
            filteredBatches = [];
            renderBatches();
        }
    } catch (err) {
        console.error('Code search failed:', err);
    }
}

// ========================================
// CHANNEL FILTER
// ========================================
function toggleBatchChannelFilter() {
    const filter = document.getElementById('batchChannelFilter');
    const isOpen = filter.classList.contains('open');
    closeAllBatchDropdowns();
    if (!isOpen) {
        filter.classList.add('open');
        positionMobilePopup(filter);
    }
}

function filterBatchByChannel(value) {
    batchChannelFilterValue = value;
    const labels = { all: '渠道', xianyu: '闲鱼', taobao: '淘宝', manual: '手动', promotion: '促销', test: '测试' };
    document.getElementById('batchChannelLabel').textContent = labels[value] || '渠道';
    document.querySelectorAll('#batchChannelPopup .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    document.getElementById('batchChannelFilter').classList.remove('open');
    applyBatchFilters();
}

// ========================================
// PACKAGE FILTER
// ========================================
function toggleBatchPackageFilter() {
    const filter = document.getElementById('batchPackageFilter');
    const isOpen = filter.classList.contains('open');
    closeAllBatchDropdowns();
    if (!isOpen) {
        filter.classList.add('open');
        positionMobilePopup(filter);
    }
}

function filterBatchByPackage(value) {
    batchPackageFilterValue = value;
    const pkg = allPackages.find(p => p.id === value);
    document.getElementById('batchPackageLabel').textContent = value === 'all' ? '套餐' : (pkg?.name || '套餐');
    document.querySelectorAll('#batchPackagePopup .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    document.getElementById('batchPackageFilter').classList.remove('open');
    applyBatchFilters();
}

function closeAllBatchDropdowns() {
    ['batchDateFilter', 'batchChannelFilter', 'batchPackageFilter'].forEach(id => {
        document.getElementById(id)?.classList.remove('open');
    });
}

// ========================================
// SORTING
// ========================================
function sortBatches(field) {
    if (batchSortField === field) {
        batchSortOrder = batchSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        batchSortField = field;
        batchSortOrder = field === 'created_at' ? 'desc' : 'asc'; // Default desc for dates
    }

    // Update sort icons
    document.querySelectorAll('#batchesTable th.sortable .sort-icon').forEach(icon => {
        icon.classList.remove('fa-sort-up', 'fa-sort-down', 'active');
        icon.classList.add('fa-sort');
    });

    const activeHeader = document.querySelector(`#batchesTable th[data-sort="${field}"] .sort-icon`);
    if (activeHeader) {
        activeHeader.classList.remove('fa-sort');
        activeHeader.classList.add(batchSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down', 'active');
    }

    applyBatchFilters();
}

// ========================================
// PAGINATION
// ========================================
function updatePaginationUI() {
    let paginationContainer = document.getElementById('batchPagination');

    // Create pagination container if it doesn't exist
    // Place it OUTSIDE the scrollable .glass-panel, directly in #points-view-batches
    if (!paginationContainer) {
        const viewSection = document.getElementById('points-view-batches');
        if (viewSection) {
            paginationContainer = document.createElement('div');
            paginationContainer.id = 'batchPagination';
            paginationContainer.className = 'pagination-controls';
            viewSection.appendChild(paginationContainer);
        }
    }

    if (!paginationContainer) return;

    const totalPages = Math.ceil(filteredBatches.length / batchPageSize);

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    paginationContainer.innerHTML = `
        <button class="pagination-btn" type="button" data-points-action="go-batch-page" data-page="${batchCurrentPage - 1}" ${batchCurrentPage === 1 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i>
        </button>
        <span class="pagination-info">${batchCurrentPage} / ${totalPages}</span>
        <button class="pagination-btn" type="button" data-points-action="go-batch-page" data-page="${batchCurrentPage + 1}" ${batchCurrentPage >= totalPages ? 'disabled' : ''}>
            <i class="fas fa-chevron-right"></i>
        </button>
        <span class="pagination-total">(共 ${filteredBatches.length} 条)</span>
    `;
}

function goToBatchPage(page) {
    const totalPages = Math.ceil(filteredBatches.length / batchPageSize);
    if (page < 1 || page > totalPages) return;
    batchCurrentPage = page;
    renderBatches();
}

// ========================================
// BATCH SELECTION
// ========================================
function toggleBatchSelectMode() {
    batchSelectMode = !batchSelectMode;

    // Use unique IDs specific to Points module to avoid conflicts with Gallery module
    const checkboxHeader = document.getElementById('batchCheckboxHeader');
    const menuContainer = document.getElementById('pointsBatchMenuContainer');
    const countWrapper = document.getElementById('pointsBatchSelectedCountWrapper');
    const selectBtn = document.getElementById('batchSelectToggle');

    if (batchSelectMode) {
        setAdminPointsVisibility(checkboxHeader, true);
        setAdminPointsVisibility(menuContainer, true);
        setAdminPointsVisibility(countWrapper, true);
        selectBtn.classList.add('active');
    } else {
        setAdminPointsVisibility(checkboxHeader, false);
        setAdminPointsVisibility(menuContainer, false);
        setAdminPointsVisibility(countWrapper, false);
        selectBtn.classList.remove('active');
        selectedBatchIds.clear();
        updateSelectedCount();
    }

    renderBatches();
}

function togglePointsBatchActionsMenu() {
    const menu = document.getElementById('pointsBatchActionsMenu');
    menu.classList.toggle('show');
}

// Close batch menu when clicking outside
document.addEventListener('click', (e) => {
    const container = document.getElementById('pointsBatchMenuContainer');
    const menu = document.getElementById('pointsBatchActionsMenu');
    if (container && menu && !container.contains(e.target)) {
        menu.classList.remove('show');
    }
});

function toggleBatchSelection(batchId) {
    if (selectedBatchIds.has(batchId)) {
        selectedBatchIds.delete(batchId);
    } else {
        selectedBatchIds.add(batchId);
    }
    updateSelectedCount();
    updateSelectAllCheckbox();

    // Update row visual state
    const row = document.querySelector(`tr[data-batch-id="${batchId}"]`);
    if (row) {
        row.classList.toggle('selected', selectedBatchIds.has(batchId));
    }
}

function toggleSelectAllBatches() {
    const checkbox = document.getElementById('selectAllBatches');
    const start = (batchCurrentPage - 1) * batchPageSize;
    const end = start + batchPageSize;
    const pageBatches = filteredBatches.slice(start, end);

    if (checkbox.checked) {
        pageBatches.forEach(b => selectedBatchIds.add(b.id));
    } else {
        pageBatches.forEach(b => selectedBatchIds.delete(b.id));
    }

    updateSelectedCount();
    renderBatches();
}

function updateSelectAllCheckbox() {
    const checkbox = document.getElementById('selectAllBatches');
    if (!checkbox) return;

    const start = (batchCurrentPage - 1) * batchPageSize;
    const end = start + batchPageSize;
    const pageBatches = filteredBatches.slice(start, end);

    const allSelected = pageBatches.length > 0 && pageBatches.every(b => selectedBatchIds.has(b.id));
    checkbox.checked = allSelected;
}

function updateSelectedCount() {
    const countEl = document.getElementById('pointsBatchSelectedCount');
    if (countEl) {
        countEl.textContent = selectedBatchIds.size;
    }
}

function clearBatchSelection() {
    selectedBatchIds.clear();
    updateSelectedCount();
    const checkbox = document.getElementById('selectAllBatches');
    if (checkbox) checkbox.checked = false;

    // If in select mode, exit it
    if (batchSelectMode) {
        toggleBatchSelectMode();
    } else {
        renderBatches();
    }
}

// ========================================
// BULK DELETE WITH OPTIONS
// ========================================
async function batchDeleteBatches() {
    if (selectedBatchIds.size === 0) {
        alert('请先选择要删除的批次');
        return;
    }

    // Close the batch menu
    const menu = document.getElementById('pointsBatchActionsMenu');
    if (menu) menu.classList.remove('show');

    // First, check if any selected batches have used codes
    const idsArray = Array.from(selectedBatchIds);
    const selectedBatches = allBatches.filter((batch) => idsArray.includes(batch.id));
    const usedCodesCount = selectedBatches.reduce((sum, batch) => sum + (Math.max(0, Number(batch?.used_count) || 0)), 0);
    const totalCodesCount = selectedBatches.reduce((sum, batch) => sum + (Math.max(0, Number(batch?.total_count) || 0)), 0);

    // Show delete options modal
    showDeleteOptionsModal(idsArray, usedCodesCount, totalCodesCount);
}

function showDeleteOptionsModal(batchIds, usedCount, totalCount) {
    // Remove existing modal
    document.querySelector('.delete-options-modal-overlay')?.remove();

    const hasUsedCodes = usedCount > 0;
    const batchCount = batchIds.length;

    const modalHtml = `
        <div class="codes-modal-overlay delete-options-modal-overlay" data-points-overlay-close="delete-options">
            <div class="codes-modal delete-options-modal points-delete-options-modal">
                <div class="codes-modal-header">
                    <h3>⚠️ 删除批次确认</h3>
                    <button class="modal-close-btn" type="button" data-points-action="close-delete-options">✕</button>
                </div>
                <div class="codes-modal-body points-delete-options-modal-body">
                    <div class="delete-summary">
                        <p>即将删除 <strong>${batchCount}</strong> 个批次，共 <strong>${totalCount}</strong> 个兑换码</p>
                        ${hasUsedCodes ? `<p class="warning-text">⚠️ 其中 <strong>${usedCount}</strong> 个已被用户使用</p>` : '<p class="success-text">✅ 所有兑换码均未使用</p>'}
                    </div>
                    
                    <div class="delete-options">
                        <label class="delete-option ${!hasUsedCodes ? 'recommended' : ''}">
                            <input type="radio" name="deleteOption" value="keep" ${!hasUsedCodes ? 'checked' : ''}>
                            <div class="option-content">
                                <span class="option-title">📋 仅删除记录</span>
                                <span class="option-desc">删除批次和兑换码记录，用户已获得的积分保留不变</span>
                            </div>
                        </label>
                        
                        ${hasUsedCodes ? `
                        <label class="delete-option danger-option">
                            <input type="radio" name="deleteOption" value="revoke">
                            <div class="option-content">
                                <span class="option-title">💸 收回积分并删除</span>
                                <span class="option-desc">撤销所有已使用的兑换码，扣回用户积分，然后删除记录</span>
                            </div>
                        </label>
                        
                        <label class="delete-option safe-option" ${hasUsedCodes ? 'checked' : ''}>
                            <input type="radio" name="deleteOption" value="block" ${hasUsedCodes ? 'checked' : ''}>
                            <div class="option-content">
                                <span class="option-title">🛡️ 仅删除未使用的码</span>
                                <span class="option-desc">保留已使用的兑换码记录（审计用），仅删除未使用的码</span>
                            </div>
                        </label>
                        ` : ''}
                    </div>
                    
                    <div class="delete-actions">
                        <button class="btn-secondary" type="button" data-points-action="close-delete-options">取消</button>
                        <button class="btn-danger" type="button" data-points-action="execute-delete-option" data-batch-ids="${encodeURIComponent(batchIds.join(','))}">
                            <i class="fas fa-trash"></i> 确认删除
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const overlay = document.querySelector('.delete-options-modal-overlay');
    if (overlay) {
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });
    }
}

function closeDeleteOptionsModal(event) {
    if (!event || event.target.classList.contains('delete-options-modal-overlay')) {
        const overlay = document.querySelector('.delete-options-modal-overlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            overlay.remove();
        }, 260);
    }
}

async function executeDeleteWithOption(batchIdsStr) {
    const writableSite = requireWritablePointsSite({ action: 'points-batch-delete' });
    if (!writableSite) {
        return;
    }

    const batchIds = batchIdsStr.split(',');
    const selectedOption = document.querySelector('input[name="deleteOption"]:checked')?.value;

    if (!selectedOption) {
        alert('请选择一个删除选项');
        return;
    }

    const btn = document.querySelector('.delete-options-modal .btn-danger');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';

    try {
        const payload = await mutatePointsManage({
            action: 'delete_batches',
            site: writableSite,
            payload: {
                batch_ids: batchIds,
                delete_mode: selectedOption
            }
        });

        alert(`✅ ${payload?.message || '批次已处理'}`);

        closeDeleteOptionsModal();
        selectedBatchIds.clear();
        updateSelectedCount();
        if (batchSelectMode) toggleBatchSelectMode();
        invalidatePointsCatalogSnapshot();
        loadBatches();

    } catch (err) {
        console.error('Delete failed:', err);
        alert('删除失败: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> 确认删除';
    }
}

function initBatchDatePickers() {
    if (typeof flatpickr === 'undefined') return;

    const fromInput = document.getElementById('batchDateFrom');
    const toInput = document.getElementById('batchDateTo');

    if (fromInput) {
        flatpickr(fromInput, {
            locale: 'zh',
            dateFormat: 'Y-m-d',
            onChange: (dates) => {
                batchCustomDateFrom = dates[0] || null;
                if (batchCustomDateFrom) {
                    batchDateFilterValue = 'custom';
                    document.getElementById('batchDateLabel').textContent = '自定义';
                    applyBatchFilters();
                }
            }
        });
    }

    if (toInput) {
        flatpickr(toInput, {
            locale: 'zh',
            dateFormat: 'Y-m-d',
            onChange: (dates) => {
                batchCustomDateTo = dates[0] ? new Date(dates[0].getTime() + 86400000 - 1) : null;
                if (batchCustomDateTo) {
                    batchDateFilterValue = 'custom';
                    document.getElementById('batchDateLabel').textContent = '自定义';
                    applyBatchFilters();
                }
            }
        });
    }
}

function copyAllCodes() {
    const text = generatedCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        alert(`已复制 ${generatedCodes.length} 个兑换码`);
    });
}

function downloadCodesCSV() {
    const csv = 'code\n' + generatedCodes.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `codes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// ========================================
// VIEW BATCH CODES
// ========================================
// VIEW BATCH CODES MODAL
// ========================================
async function viewBatchCodes(batchId) {
    const batch = allBatches.find(b => b.id === batchId);
    if (!batch) return;

    // Show loading modal immediately
    document.querySelector('.codes-modal-overlay')?.remove();
    const loadingHtml = `
        <div class="codes-modal-overlay" data-points-overlay-close="codes">
            <div class="codes-modal">
                <div class="codes-modal-header">
                    <h3>📦 ${batch.name}</h3>
                    <span class="codes-count">加载中...</span>
                    <button class="modal-close-btn" type="button" data-points-action="close-codes-modal">✕</button>
                </div>
                <div class="codes-modal-body loading-state">
                    <div class="loading-text">⏳ 加载兑换码...</div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', loadingHtml);
    const overlay = document.querySelector('.codes-modal-overlay');
    if (overlay) {
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });
    }
    window.currentViewBatchId = batchId;

    try {
        const payload = await fetchPointsBatchesPayload({
            site: getPointsReadSite(),
            batchId
        });
        const data = Array.isArray(payload?.codes) ? payload.codes : [];

        // Update modal content (replace loading with actual data)
        const modalBody = document.querySelector('.codes-modal-body');
        const modalCount = document.querySelector('.codes-count');
        if (!modalBody) return; // Modal was closed

        modalCount.textContent = `${data.length} 个兑换码`;

        const tableHtml = data.map(c => {
            const statusMap = {
                pending: '<span class="status-badge pending">⏳ 待使用</span>',
                used: '<span class="status-badge used">✅ 已使用</span>',
                revoked: '<span class="status-badge revoked">❌ 已撤销</span>',
                locked: '<span class="status-badge locked">🔒 已锁定</span>',
                disabled: '<span class="status-badge disabled">🚫 已禁用</span>',
                expired: '<span class="status-badge expired">⌛ 已过期</span>'
            };

            // Build detail info
            let detailHtml = '-';
            if (c.status === 'used' && c.used_profile) {
                const userName = c.used_profile.username || c.used_profile.email || '未知用户';
                const usedAt = c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : '';
                // Make user clickable to navigate to user management
                detailHtml = `<div class="code-detail">
                    <span class="detail-user user-link" data-points-action="navigate-user" data-user-id="${encodeURIComponent(c.used_by)}" title="查看用户详情">👤 ${userName}</span>
                    <span class="detail-time">${usedAt}</span>
                </div>`;
            } else if (c.status === 'revoked') {
                const reason = c.revoke_reason || '无原因';
                const revokedAt = c.revoked_at ? new Date(c.revoked_at).toLocaleString('zh-CN') : '';
                const userName = c.used_profile ? (c.used_profile.username || c.used_profile.email) : null;
                const usedAt = c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : '';
                const revokerName = c.revoked_by ? (c.revoker_name || '管理员') : '系统';
                detailHtml = `<div class="code-detail revoked-detail">
                    ${userName ? `<span class="detail-user strikethrough user-link" data-points-action="navigate-user" data-user-id="${encodeURIComponent(c.used_by)}" title="查看用户详情">👤 ${userName} (${usedAt})</span>` : ''}
                    <span class="detail-reason">📝 撤销: ${reason}</span>
                    <span class="detail-revoker">🛡️ 操作者: ${revokerName}</span>
                    <span class="detail-time">🕐 ${revokedAt}</span>
                </div>`;
            } else if (c.status === 'disabled') {
                detailHtml = '<span class="detail-disabled">管理员禁用</span>';
            }

            // Build action buttons
            let actionHtml = '';

            // Add expiry button for pending codes
            if (c.status === 'pending') {
                const expiryDisplay = c.expires_at
                    ? new Date(c.expires_at).toLocaleDateString('zh-CN')
                    : '无';
                actionHtml += `
                    <button class="btn-icon btn-expiry" type="button" data-points-action="set-code-expiry" data-code="${encodeURIComponent(c.code)}" data-code-expiry="${encodeURIComponent(c.expires_at || '')}" title="设置有效期">
                        <i class="fas fa-calendar-alt"></i>
                    </button>`;
                actionHtml += `
                    <button class="btn-revoke" type="button" data-points-action="disable-code" data-code="${encodeURIComponent(c.code)}" title="禁用">
                        <i class="fas fa-ban"></i>
                    </button>`;
            } else if (c.status === 'used') {
                actionHtml = `
                    <button class="btn-revoke" type="button" data-points-action="revoke-code" data-code="${encodeURIComponent(c.code)}" title="撤销">
                        <i class="fas fa-undo"></i> 撤销
                    </button>`;
            } else if (c.status === 'disabled') {
                actionHtml = `
                    <button class="btn-enable" type="button" data-points-action="enable-code" data-code="${encodeURIComponent(c.code)}" title="启用">
                        <i class="fas fa-check"></i> 启用
                    </button>`;
            }

            if (!actionHtml) actionHtml = '-';

            // Format expiry display
            const expiryText = c.expires_at
                ? `<span class="code-expiry ${new Date(c.expires_at) < new Date() ? 'expired' : ''}">${new Date(c.expires_at).toLocaleDateString('zh-CN')}</span>`
                : '<span class="code-expiry-none">继承批次</span>';

            return `<tr class="code-row ${c.status}">
                <td class="code-cell">${c.code}</td>
                <td>${statusMap[c.status] || c.status}</td>
                <td>${expiryText}</td>
                <td>${detailHtml}</td>
                <td class="actions-cell">${actionHtml}</td>
            </tr>`;
        }).join('');

        // Remove loading state class
        modalBody.classList.remove('loading-state');

        modalBody.innerHTML = `
            <table class="codes-table">
                <thead><tr><th>兑换码</th><th>状态</th><th>有效期</th><th>详情</th><th>操作</th></tr></thead>
                <tbody>${tableHtml}</tbody>
            </table>
        `;

        // Reset scroll to top AFTER content is set
        modalBody.scrollTop = 0;

        // Enable horizontal scroll with mouse wheel on modal table
        enableHorizontalScroll(modalBody);

    } catch (err) {
        const modalBody = document.querySelector('.codes-modal-body');
        if (modalBody) {
            modalBody.innerHTML = `<div class="error-text points-codes-error">❌ 加载失败: ${err.message}</div>`;
        }
    }
}

// Close codes modal
function closeCodesModal(event) {
    if (!event || event.target.classList.contains('codes-modal-overlay')) {
        const overlay = document.querySelector('.codes-modal-overlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            overlay.remove();
        }, 260);
        window.currentViewBatchId = null;
    }
}

// ========================================
// SET CODE EXPIRY
// ========================================
async function setCodeExpiry(code, currentExpiry) {
    const writableSite = requireWritablePointsSite({ label: '设置兑换码有效期' });
    if (!writableSite) {
        return;
    }

    // Format current expiry for input
    let defaultValue = '';
    if (currentExpiry) {
        const date = new Date(currentExpiry);
        defaultValue = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    }

    const newExpiry = prompt(
        `设置兑换码 ${code} 的有效期\n\n` +
        `当前有效期: ${currentExpiry ? new Date(currentExpiry).toLocaleDateString('zh-CN') : '继承批次'}\n\n` +
        `请输入新的有效期 (格式: YYYY-MM-DD)\n` +
        `留空则清除独立有效期，恢复继承批次有效期:`,
        defaultValue
    );

    if (newExpiry === null) return; // User cancelled

    // Validate date format
    let expiresAt = null;
    if (newExpiry.trim()) {
        const parsed = new Date(newExpiry.trim());
        if (isNaN(parsed.getTime())) {
            alert('❌ 无效的日期格式，请使用 YYYY-MM-DD 格式');
            return;
        }
        // Set to end of day
        parsed.setHours(23, 59, 59, 999);
        expiresAt = parsed.toISOString();
    }

    try {
        const payload = await mutatePointsManage({
            action: 'set_code_expiry',
            site: writableSite,
            payload: {
                code,
                expires_at: expiresAt
            }
        });

        alert(`✅ ${payload?.message || '有效期已更新'}`);

        // Refresh modal
        if (window.currentViewBatchId) {
            viewBatchCodes(window.currentViewBatchId);
        }
    } catch (err) {
        alert('❌ 设置失败: ' + err.message);
    }
}

// ========================================
// REVOKE CODE
// ========================================
async function revokeCode(code) {
    const writableSite = requireWritablePointsSite({ label: '撤销兑换码' });
    if (!writableSite) {
        return;
    }

    const reason = prompt(`确定要撤销兑换码 ${code} 吗？\n\n请输入撤销原因（可选）：`);

    if (reason === null) return; // User cancelled

    try {
        const payload = await mutatePointsManage({
            action: 'revoke_code',
            site: writableSite,
            payload: {
                code,
                reason: reason || '管理员撤销'
            }
        });

        const deducted = payload?.points_deducted || 0;
        alert(`✅ ${payload?.message || '撤销成功'}${deducted > 0 ? `\n已扣除用户 ${deducted} 积分` : ''}`);

        // Refresh modal
        if (window.currentViewBatchId) {
            viewBatchCodes(window.currentViewBatchId);
        }

        // Refresh batch list
        invalidatePointsCatalogSnapshot();
        loadBatches();
    } catch (err) {
        alert('❌ 撤销失败: ' + err.message);
    }
}

// ========================================
// EXPORT BATCH CSV
// ========================================
// ========================================
// EXPORT FUNCTIONS (Excel .xlsx)
// ========================================

// Toggle export dropdown menu
function toggleBatchExportMenu() {
    const dropdown = document.getElementById('batchExportDropdown');
    const popup = document.getElementById('batchExportPopup');

    // Close other dropdowns first
    closeAllBatchDropdowns();

    if (dropdown && popup) {
        const wasOpen = dropdown.classList.contains('open');
        dropdown.classList.toggle('open');
        popup.classList.toggle('show');

        // Position for mobile
        if (!wasOpen) {
            positionMobilePopup(dropdown);
        }
    }

    // Show/hide "export selected" option based on selection
    const exportSelectedOption = document.getElementById('exportSelectedOption');
    if (exportSelectedOption) {
        setAdminPointsVisibility(exportSelectedOption, selectedBatchIds.size > 0);
    }
}

// Export batch list to Excel
async function exportBatchList() {
    // Close menu
    closeAllBatchDropdowns();

    if (allBatches.length === 0) {
        alert('暂无批次可导出');
        return;
    }

    const channelLabels = {
        xianyu: '闲鱼',
        taobao: '淘宝',
        manual: '手动',
        promotion: '促销',
        test: '测试'
    };

    // Prepare data
    const data = allBatches.map(batch => ({
        '批次名称': batch.name,
        '套餐': batch.points_packages?.name || '-',
        '渠道': channelLabels[batch.channel] || batch.channel,
        '总数': batch.total_count,
        '已用': batch.used_count,
        '剩余': batch.total_count - batch.used_count,
        '使用率': `${batch.total_count > 0 ? Math.round((batch.used_count / batch.total_count) * 100) : 0}%`,
        '创建时间': new Date(batch.created_at).toLocaleString('zh-CN'),
        '过期时间': batch.expires_at ? new Date(batch.expires_at).toLocaleString('zh-CN') : '永不过期',
        '备注': batch.notes || ''
    }));

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '批次列表');

    // Set column widths
    ws['!cols'] = [
        { wch: 20 }, // 批次名称
        { wch: 15 }, // 套餐
        { wch: 8 },  // 渠道
        { wch: 8 },  // 总数
        { wch: 8 },  // 已用
        { wch: 8 },  // 剩余
        { wch: 8 },  // 使用率
        { wch: 18 }, // 创建时间
        { wch: 18 }, // 过期时间
        { wch: 20 }  // 备注
    ];

    // Export
    const now = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `批次列表_${now}.xlsx`);
}

// Export selected batches (with all codes)
async function exportSelectedBatches() {
    closeAllBatchDropdowns();

    if (selectedBatchIds.size === 0) {
        alert('请先选择要导出的批次');
        return;
    }

    try {
        const wb = XLSX.utils.book_new();
        const usedNames = new Set();
        let index = 1;

        for (const batchId of selectedBatchIds) {
            const batch = allBatches.find(b => b.id === batchId);
            if (!batch) continue;

            const sheetData = await getBatchCodesData(batchId);
            const ws = XLSX.utils.json_to_sheet(sheetData);

            // Truncate sheet name to 31 chars (Excel limit) and ensure uniqueness
            let baseName = batch.name.slice(0, 28).replace(/[\\\\/\*\?\[\]:]/g, '_');
            let sheetName = baseName;

            // If name already used, append index
            while (usedNames.has(sheetName)) {
                sheetName = `${baseName}_${index}`;
                index++;
            }
            usedNames.add(sheetName);

            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }

        const now = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `选中批次_${selectedBatchIds.size}个_${now}.xlsx`);

    } catch (err) {
        alert('导出失败: ' + err.message);
    }
}

// Export single batch codes to Excel
async function exportBatchCodes(batchId) {
    const batch = allBatches.find(b => b.id === batchId);
    if (!batch) return;

    try {
        const data = await getBatchCodesData(batchId);

        // Create workbook
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '兑换码列表');

        // Set column widths
        ws['!cols'] = [
            { wch: 18 }, // 兑换码
            { wch: 10 }, // 状态
            { wch: 18 }, // 创建时间
            { wch: 15 }, // 使用者
            { wch: 18 }, // 使用时间
            { wch: 20 }, // 撤销原因
            { wch: 15 }, // 撤销者
            { wch: 18 }  // 撤销时间
        ];

        // Export
        const now = new Date().toISOString().slice(0, 10);
        const fileName = `${batch.name.replace(/\s+/g, '_')}_兑换码_${now}.xlsx`;
        XLSX.writeFile(wb, fileName);

    } catch (err) {
        alert('导出失败: ' + err.message);
    }
}

// Helper: Get batch codes data for export
async function getBatchCodesData(batchId) {
    const payload = await fetchPointsBatchesPayload({
        site: getPointsReadSite(),
        batchId
    });
    const data = Array.isArray(payload?.codes) ? payload.codes : [];

    const statusMap = { pending: '待使用', used: '已使用', revoked: '已撤销', locked: '已锁定', expired: '已过期', disabled: '已禁用' };

    return data.map(c => ({
        '兑换码': c.code,
        '状态': statusMap[c.status] || c.status,
        '创建时间': c.created_at ? new Date(c.created_at).toLocaleString('zh-CN') : '',
        '使用者': c.used_profile ? (c.used_profile.username || c.used_profile.email || '') : '',
        '使用时间': c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : '',
        '撤销原因': c.revoke_reason || '',
        '撤销者': c.revoked_by ? (c.revoker_name || '管理员') : '',
        '撤销时间': c.revoked_at ? new Date(c.revoked_at).toLocaleString('zh-CN') : ''
    }));
}

// Legacy function name for backward compatibility
async function exportBatchCSV(batchId) {
    return exportBatchCodes(batchId);
}

// ========================================
// BATCH EDITING
// ========================================

// Open batch edit modal
function openBatchEditModal(batchId) {
    const batch = allBatches.find(b => b.id === batchId);
    if (!batch) return;

    // Remove existing modal if any
    document.querySelector('.edit-modal-overlay')?.remove();

    const modalHtml = `
        <div class="edit-modal-overlay" data-points-overlay-close="batch-edit">
            <div class="edit-modal">
                <div class="edit-modal-header">
                    <h3>✏️ 编辑批次</h3>
                    <button class="edit-modal-close" type="button" data-points-action="close-batch-edit">✕</button>
                </div>
                <form id="batchEditForm" class="edit-modal-form" data-points-submit="save-batch-edit" data-batch-id="${encodeURIComponent(batchId)}">
                    <div class="edit-field">
                        <label>批次名称</label>
                        <input type="text" id="editBatchName" value="${batch.name}" required maxlength="100">
                    </div>
                    <div class="edit-field">
                        <label>备注</label>
                        <textarea id="editBatchNotes" rows="3" placeholder="添加备注信息...">${batch.notes || ''}</textarea>
                    </div>
                    <div class="edit-field">
                        <label>过期时间</label>
                        <input type="text" id="editBatchExpires" class="flatpickr-input" 
                            value="${batch.expires_at ? new Date(batch.expires_at).toISOString().slice(0, 16).replace('T', ' ') : ''}" 
                            placeholder="留空表示永不过期">
                    </div>
                    <button type="submit" class="edit-modal-save">
                        <i class="fas fa-save"></i> 保存修改
                    </button>
                </form>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const overlay = document.querySelector('.edit-modal-overlay');
    if (overlay) {
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });
    }

    // Initialize flatpickr for expires input
    if (typeof flatpickr !== 'undefined') {
        flatpickr('#editBatchExpires', {
            enableTime: true,
            dateFormat: "Y-m-d H:i",
            time_24hr: true,
            locale: "zh",
            allowInput: true,
            minDate: "today"
        });
    }
}

function closeBatchEditModal(event) {
    if (!event || event.target.classList.contains('edit-modal-overlay')) {
        const overlay = document.querySelector('.edit-modal-overlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            overlay.remove();
        }, 260);
    }
}

async function saveBatchEdit(event, batchId) {
    event.preventDefault();

    const writableSite = requireWritablePointsSite({ label: '保存兑换码批次' });
    if (!writableSite) {
        return;
    }

    const name = document.getElementById('editBatchName').value.trim();
    const notes = document.getElementById('editBatchNotes').value.trim();
    const expiresInput = document.getElementById('editBatchExpires').value.trim();
    const expiresAt = expiresInput ? new Date(expiresInput).toISOString() : null;

    if (!name) {
        alert('批次名称不能为空');
        return;
    }

    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';

    try {
        const payload = await mutatePointsManage({
            action: 'update_batch',
            site: writableSite,
            payload: {
                batch_id: batchId,
                name: name,
                notes: notes || null,
                expires_at: expiresAt
            }
        });

        alert(`✅ ${payload?.message || '保存成功'}`);
        closeBatchEditModal();
        invalidatePointsCatalogSnapshot();
        loadBatches();

    } catch (err) {
        alert('保存失败: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 保存';
    }
}

// ========================================
// CODE STATUS MANAGEMENT
// ========================================

// Disable a single code (mark as disabled/invalid)
async function disableCode(code) {
    const writableSite = requireWritablePointsSite({ label: '禁用兑换码' });
    if (!writableSite) {
        return;
    }

    const confirmed = confirm(`确定要禁用兑换码 ${code} 吗？\n\n禁用后该码将无法被使用。`);
    if (!confirmed) return;

    try {
        const payload = await mutatePointsManage({
            action: 'set_code_status',
            site: writableSite,
            payload: {
                code,
                status: 'disabled'
            }
        });

        alert(`✅ ${payload?.message || '已禁用该兑换码'}`);

        // Refresh modal if open
        if (window.currentViewBatchId) {
            viewBatchCodes(window.currentViewBatchId);
        }
        loadBatches();

    } catch (err) {
        alert('禁用失败: ' + err.message);
    }
}

// Enable a previously disabled code
async function enableCode(code) {
    const writableSite = requireWritablePointsSite({ label: '启用兑换码' });
    if (!writableSite) {
        return;
    }

    try {
        const payload = await mutatePointsManage({
            action: 'set_code_status',
            site: writableSite,
            payload: {
                code,
                status: 'pending'
            }
        });

        alert(`✅ ${payload?.message || '已启用该兑换码'}`);

        if (window.currentViewBatchId) {
            viewBatchCodes(window.currentViewBatchId);
        }
        loadBatches();

    } catch (err) {
        alert('启用失败: ' + err.message);
    }
}

// Batch invalidate all unused codes in selected batches
async function batchInvalidateCodes() {
    const writableSite = requireWritablePointsSite({ action: 'points-batch-invalidate' });
    if (!writableSite) {
        return;
    }

    if (selectedBatchIds.size === 0) {
        alert('请先选择要操作的批次');
        return;
    }

    const batchNames = Array.from(selectedBatchIds)
        .map(id => allBatches.find(b => b.id === id)?.name)
        .filter(Boolean)
        .join('、');

    const confirmed = confirm(`确定要作废以下批次中所有未使用的兑换码吗？\n\n批次: ${batchNames}\n\n此操作不可恢复！`);
    if (!confirmed) return;

    try {
        const idsArray = Array.from(selectedBatchIds);
        const payload = await mutatePointsManage({
            action: 'invalidate_batches',
            site: writableSite,
            payload: {
                batch_ids: idsArray
            }
        });

        alert(`✅ ${payload?.message || '操作完成'}`);

        // Close menu and refresh
        const menu = document.getElementById('pointsBatchActionsMenu');
        if (menu) menu.classList.remove('show');

        invalidatePointsCatalogSnapshot();
        loadBatches();

    } catch (err) {
        alert('操作失败: ' + err.message);
    }
}

// Navigate to user from redemption record
function navigateToUser(userId) {
    if (!userId) return;

    // Close the codes modal first
    document.querySelector('.codes-modal-overlay')?.remove();

    // Switch to users module and open the user
    if (typeof switchModule === 'function') {
        switchModule('users');
        // Wait for module switch then open user modal
        setTimeout(() => {
            if (typeof openUserModal === 'function') {
                openUserModal(userId);
            }
        }, 300);
    }
}

// ========================================
// LOOKUP CODE
// ========================================
async function lookupCode() {
    const input = document.getElementById('lookupCodeInput');
    const code = input.value.trim(); // Do not uppercase immediately, UUIDs might be lowercase
    const resultDiv = document.getElementById('lookupResult');

    if (!code) {
        alert('请输入兑换码或订单号');
        return;
    }

    // Show loading state
    resultDiv.innerHTML = '<div class="lookup-card"><div class="lookup-status">🔍 查询中...</div></div>';
    setAdminPointsPanelVisible(resultDiv, true);

    try {
        const payload = await fetchPointsLookupPayload({
            site: getPointsReadSite(),
            q: code
        });
        renderLookupResult(payload?.result || {}, payload?.kind === 'ledger' ? 'ledger' : 'code');

    } catch (err) {
        resultDiv.innerHTML = `<div class="lookup-card invalid"><div class="lookup-status">❌ 查询失败</div><p>${err.message}</p></div>`;
        setAdminPointsPanelVisible(resultDiv, true);
    }
}

function renderLookupResult(data, type) {
    const resultDiv = document.getElementById('lookupResult');

    if (type === 'ledger') {
        const reason = formatLedgerReason ? formatLedgerReason(data.reason, data.created_at, data.reference_id) : data.reason;
        // Extract text from HTML if formatLedgerReason returns HTML
        const reasonText = reason.includes('<') ? reason.replace(/<[^>]+>/g, '') : reason;

        resultDiv.innerHTML = `
            <div class="lookup-card valid">
                <div class="lookup-query-type">🧾 积分流水查询</div>
                <div class="lookup-status">✅ 记录存在</div>
                
                <div class="lookup-detail">
                    <span class="label">流水ID:</span>
                    <span class="value code-value" title="${data.id}">${data.id}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">类型/原因:</span>
                    <span class="value text-warning">${data.reason}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">关联ID:</span>
                    <span class="value">
                        <span class="code-value admin-points-reference-id">${data.reference_id || '-'}</span>
                        ${data.prompt_title ? `<div class="lookup-prompt-title">Prompt: ${data.prompt_title}</div>` : ''}
                    </span>
                </div>
                <div class="lookup-detail">
                    <span class="label">变动金额:</span>
                    <span class="value admin-points-ledger-amount ${data.amount >= 0 ? 'text-success' : 'text-danger'}">
                        ${data.amount >= 0 ? '+' : ''}${data.amount}
                    </span>
                </div>
                <div class="lookup-detail">
                    <span class="label">用户:</span>
                    <span class="value">👤 ${data.profiles?.username || data.profiles?.email || '未知用户'}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">创建时间:</span>
                    <span class="value admin-points-lookup-value-sans">${new Date(data.created_at).toLocaleString('zh-CN')}</span>
                </div>
            </div>
        `;
        setAdminPointsPanelVisible(resultDiv, true);
        return;
    }

    // Default: Redeem Code Result
    const statusLabels = {
        pending: '⏳ 待使用',
        locked: '🔒 已锁定',
        used: '✅ 已使用',
        revoked: '❌ 已撤销',
        disabled: '🚫 已禁用'
    };
    const queryTypeLabel = data.query_type === 'order' ? '📦 订单号查询' : '🎫 兑换码查询';

    resultDiv.innerHTML = `
            <div class="lookup-card ${data.valid ? 'valid' : 'invalid'}">
                <div class="lookup-query-type">${queryTypeLabel}</div>
                <div class="lookup-status">${statusLabels[data.status] || data.status}</div>
                ${data.code ? `
                <div class="lookup-detail">
                    <span class="label">兑换码:</span>
                    <span class="value code-value">${data.code}</span>
                </div>
                ` : ''}
                ${data.external_order_id ? `
                <div class="lookup-detail">
                    <span class="label">订单号:</span>
                    <span class="value">${data.external_order_id}</span>
                </div>
                ` : ''}
                ${data.batch_id ? `
                <div class="lookup-detail">
                    <span class="label">所属批次:</span>
                    <span class="value">
                        <a href="#" class="batch-link" data-points-action="navigate-batch" data-batch-id="${encodeURIComponent(data.batch_id)}">
                            📦 ${data.batch_name || '未命名批次'}
                        </a>
                    </span>
                </div>
                ` : ''}
                <div class="lookup-detail">
                    <span class="label">套餐:</span>
                    <span class="value">${data.package_name || '-'}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">积分:</span>
                    <span class="value">${data.points || 0}</span>
                </div>
                ${data.used_by ? `
                <div class="lookup-detail">
                    <span class="label">使用者:</span>
                    <span class="value">👤 ${data.used_by}</span>
                </div>
                ` : ''}
                ${data.used_at ? `
                <div class="lookup-detail">
                    <span class="label">使用时间:</span>
                    <span class="value">${new Date(data.used_at).toLocaleString('zh-CN')}</span>
                </div>
                ` : ''}
                ${data.revoke_reason ? `
                <div class="lookup-detail">
                    <span class="label">撤销原因:</span>
                    <span class="value admin-points-lookup-value-danger">📝 ${data.revoke_reason}</span>
                </div>
                ` : ''}
                ${data.revoked_by ? `
                <div class="lookup-detail">
                    <span class="label">撤销者:</span>
                    <span class="value">🛡️ ${data.revoked_by}</span>
                </div>
                ` : ''}
                ${data.revoked_at ? `
                <div class="lookup-detail">
                    <span class="label">撤销时间:</span>
                    <span class="value">${new Date(data.revoked_at).toLocaleString('zh-CN')}</span>
                </div>
                ` : ''}
                ${data.expires_at ? `
                <div class="lookup-detail">
                    <span class="label">过期时间:</span>
                    <span class="value">${new Date(data.expires_at).toLocaleString('zh-CN')}</span>
                </div>
                ` : ''}
            </div>
            `;
    setAdminPointsPanelVisible(resultDiv, true);
}

// Navigate to batch management and open specific batch
function navigateToBatch(batchId) {
    // Switch to batches tab
    const batchTab = document.querySelector('#module-points .admin-tab[data-tab="points-view-batches"]');
    if (batchTab) {
        batchTab.click();
    }

    // Wait for tab switch, then open batch details
    setTimeout(() => {
        viewBatchCodes(batchId);
    }, 200);
}

// ========================================
// INIT
// ========================================
// Triggered when points module is activated
document.addEventListener('DOMContentLoaded', () => {
    const initPointsIndicator = () => {
        // Initialize tab indicator position for Points module
        setTimeout(() => {
            const activeTab = document.querySelector('#module-points .admin-tab.active');
            const indicator = document.querySelector('#module-points .admin-tab-indicator');
            syncPointsTabIndicator(indicator, activeTab);
        }, 100);
    };

    if (window.adminStudioAccessGranted) {
        initPointsIndicator();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initPointsIndicator, { once: true });
});

window.addEventListener('admin-site-changed', async () => {
    invalidatePointsCatalogSnapshot();
    clearPointsViewPrefetch();

    const pointsModule = document.getElementById('module-points');
    if (!pointsModule?.classList.contains('active')) {
        return;
    }

    const activeView = document.querySelector('#module-points .view-section.active')?.id || '';
    if (activeView === 'points-view-catalog') {
        await loadPointsPackageCatalog({ force: true });
        schedulePointsViewPrefetch('catalog');
        return;
    }

    if (activeView === 'points-view-batches') {
        await loadBatches();
        schedulePointsViewPrefetch('batches');
        return;
    }

    if (activeView === 'points-view-generate') {
        await loadPackagesForSelect();
        initBatchExpiresPicker();
        schedulePointsViewPrefetch('generate');
        return;
    }

    schedulePointsViewPrefetch(activeView.replace(/^points-view-/, '') || 'batches');
});
