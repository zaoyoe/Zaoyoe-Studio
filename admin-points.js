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

function requireWritablePointsCodeActionSite(mode = '') {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    if (normalizedMode === 'expiry') {
        return requireWritablePointsSite({ label: '设置兑换码有效期' });
    }
    if (normalizedMode === 'disable') {
        return requireWritablePointsSite({ label: '禁用兑换码' });
    }
    if (normalizedMode === 'enable') {
        return requireWritablePointsSite({ label: '启用兑换码' });
    }
    if (normalizedMode === 'revoke') {
        return requireWritablePointsSite({ label: '撤销兑换码' });
    }
    return requireWritablePointsSite({ label: '处理兑换码' });
}

function getPointsReadSite() {
    return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
}

function escapePointsHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

function announcePointsAction(message = '', tone = 'success') {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return;
    }

    if (typeof showToast === 'function') {
        showToast(normalizedMessage, tone);
        return;
    }

    alert(normalizedMessage);
}

async function copyPointsTextToClipboard(text = '', {
    successMessage = '已复制',
    emptyMessage = '没有可复制的内容',
    errorPrefix = '复制失败',
    announcer = announcePointsAction
} = {}) {
    const normalizedText = String(text || '').trim();
    const notify = typeof announcer === 'function' ? announcer : announcePointsAction;
    if (!normalizedText) {
        notify(emptyMessage, 'error');
        return false;
    }

    const clipboard = window?.navigator?.clipboard;
    if (!clipboard?.writeText) {
        notify('当前环境暂不支持自动复制，请手动复制。', 'error');
        return false;
    }

    try {
        await clipboard.writeText(normalizedText);
        notify(successMessage, 'success');
        return true;
    } catch (error) {
        notify(`${errorPrefix}: ${error.message}`, 'error');
        return false;
    }
}

let pointsCatalogSnapshot = null;
let pointsCatalogSite = '';
let pointsCatalogRows = [];
let pointsPackageEditorState = {
    mode: 'create',
    packageId: ''
};
let pointsPackageEditorInitialized = false;
let pointsCatalogFilterState = {
    search: '',
    status: 'all',
    sort: 'sort_order_asc'
};
let generatedBatchContext = {
    batchName: '',
    count: 0,
    site: '',
    channel: '',
    packageLabel: ''
};
let pendingBatchSearchTerm = '';
let pendingGenerateSeed = null;
let pointsBatchCodesUiState = {
    batchId: '',
    search: '',
    status: 'all',
    codes: [],
    visibleCodes: [],
    focusCode: ''
};
let pointsBatchEditContext = {
    batchId: '',
    returnToCodes: false
};
let pendingPointsBatchCodeFocus = {
    batchId: '',
    code: ''
};
let pointsCodeActionModalState = {
    mode: '',
    code: '',
    currentExpiry: '',
    source: '',
    submitting: false
};
let pointsBatchInvalidateModalState = {
    batchIds: [],
    submitting: false
};
let pointsPackageDeleteModalState = {
    packageId: '',
    submitting: false
};
let pointsLookupFeedbackState = {
    message: '',
    tone: 'info'
};
let pointsBatchCodesFeedbackState = {
    batchId: '',
    message: '',
    tone: 'info'
};
let pointsBatchListFeedbackState = {
    message: '',
    tone: 'info',
    kind: '',
    detail: '',
    stats: []
};
let pointsAnalyticsFocusTimeoutId = 0;
let pointsBatchListLoadRequestId = 0;
let pointsBatchCodesRequestId = 0;
let pointsPendingBatchOpenHandle = 0;
let pointsPendingBatchOpenToken = 0;

function buildPointsInlineFeedbackMarkup(message = '', tone = 'info') {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return '';
    }

    const options = arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
    const detail = String(options.detail || '').trim();
    const stats = Array.isArray(options.stats)
        ? options.stats
            .map((item) => {
                const label = String(item?.label || '').trim();
                const value = String(item?.value ?? '').trim();
                if (!label || !value) {
                    return null;
                }
                return { label, value };
            })
            .filter(Boolean)
        : [];

    const iconMap = {
        success: 'fas fa-circle-check',
        error: 'fas fa-circle-exclamation',
        warning: 'fas fa-triangle-exclamation',
        info: 'fas fa-circle-info'
    };
    const normalizedTone = ['success', 'error', 'warning', 'info'].includes(String(tone || '').trim().toLowerCase())
        ? String(tone || '').trim().toLowerCase()
        : 'info';

    return `
        <div class="points-inline-feedback points-inline-feedback--${escapePointsHtml(normalizedTone)}">
            <span class="points-inline-feedback__icon"><i class="${escapePointsHtml(iconMap[normalizedTone])}"></i></span>
            <span class="points-inline-feedback__body">
                <span class="points-inline-feedback__copy">${escapePointsHtml(normalizedMessage)}</span>
                ${detail ? `<span class="points-inline-feedback__detail">${escapePointsHtml(detail)}</span>` : ''}
                ${stats.length ? `
                    <span class="points-inline-feedback__stats">
                        ${stats.map((item) => `
                            <span class="points-inline-feedback__stat">
                                <span class="points-inline-feedback__stat-label">${escapePointsHtml(item.label)}</span>
                                <strong class="points-inline-feedback__stat-value">${escapePointsHtml(item.value)}</strong>
                            </span>
                        `).join('')}
                    </span>
                ` : ''}
            </span>
        </div>
    `;
}

function renderPointsLookupFeedback() {
    const root = document.getElementById('pointsLookupInlineFeedback');
    if (!root) {
        return;
    }
    root.innerHTML = buildPointsInlineFeedbackMarkup(pointsLookupFeedbackState.message, pointsLookupFeedbackState.tone);
}

function clearPointsLookupFeedback() {
    pointsLookupFeedbackState = {
        message: '',
        tone: 'info'
    };
    renderPointsLookupFeedback();
}

function setPointsLookupFeedback(message = '', tone = 'info') {
    pointsLookupFeedbackState = {
        message: String(message || '').trim(),
        tone: String(tone || 'info').trim().toLowerCase() || 'info'
    };
    renderPointsLookupFeedback();
}

function renderPointsBatchCodesFeedback() {
    const root = document.getElementById('pointsBatchCodesInlineFeedback');
    if (!root) {
        return;
    }
    root.innerHTML = buildPointsInlineFeedbackMarkup(pointsBatchCodesFeedbackState.message, pointsBatchCodesFeedbackState.tone);
}

function clearPointsBatchCodesFeedback(batchId = '') {
    const normalizedBatchId = String(batchId || '').trim();
    if (normalizedBatchId && normalizedBatchId !== String(pointsBatchCodesFeedbackState.batchId || '').trim()) {
        return;
    }
    pointsBatchCodesFeedbackState = {
        batchId: '',
        message: '',
        tone: 'info'
    };
    renderPointsBatchCodesFeedback();
}

function setPointsBatchCodesFeedback(message = '', tone = 'info', batchId = '') {
    pointsBatchCodesFeedbackState = {
        batchId: String(batchId || window.currentViewBatchId || pointsBatchCodesUiState.batchId || '').trim(),
        message: String(message || '').trim(),
        tone: String(tone || 'info').trim().toLowerCase() || 'info'
    };
    renderPointsBatchCodesFeedback();
}

function renderPointsBatchListFeedback() {
    const root = document.getElementById('pointsBatchListInlineFeedback');
    if (!root) {
        return;
    }
    root.innerHTML = buildPointsInlineFeedbackMarkup(pointsBatchListFeedbackState.message, pointsBatchListFeedbackState.tone, {
        detail: pointsBatchListFeedbackState.detail,
        stats: pointsBatchListFeedbackState.stats
    });
}

function clearPointsBatchListFeedback(kind = '') {
    const normalizedKind = String(kind || '').trim();
    if (normalizedKind && normalizedKind !== String(pointsBatchListFeedbackState.kind || '').trim()) {
        return;
    }
    pointsBatchListFeedbackState = {
        message: '',
        tone: 'info',
        kind: '',
        detail: '',
        stats: []
    };
    renderPointsBatchListFeedback();
}

function setPointsBatchListFeedback(message = '', tone = 'info', kind = 'action') {
    const options = arguments[3] && typeof arguments[3] === 'object' ? arguments[3] : {};
    const stats = Array.isArray(options.stats)
        ? options.stats
            .map((item) => {
                const label = String(item?.label || '').trim();
                const value = String(item?.value ?? '').trim();
                if (!label || !value) {
                    return null;
                }
                return { label, value };
            })
            .filter(Boolean)
        : [];
    pointsBatchListFeedbackState = {
        message: String(message || '').trim(),
        tone: String(tone || 'info').trim().toLowerCase() || 'info',
        kind: String(kind || 'action').trim().toLowerCase() || 'action',
        detail: String(options.detail || '').trim(),
        stats
    };
    renderPointsBatchListFeedback();
}

function clearPointsLookupResult({ renderEmptyState = false } = {}) {
    const resultDiv = document.getElementById('lookupResult');
    if (!resultDiv) {
        return false;
    }

    clearPointsLookupFeedback();
    if (renderEmptyState) {
        renderLookupEmptyState();
        return true;
    }

    resultDiv.innerHTML = '';
    setAdminPointsPanelVisible(resultDiv, false);
    return true;
}

async function refreshPointsLookupResultIfNeeded({ activeViewOnly = false } = {}) {
    const lookupInput = document.getElementById('lookupCodeInput');
    const query = String(lookupInput?.value || '').trim();
    if (!query) {
        return false;
    }

    if (activeViewOnly && getActivePointsViewName() !== 'lookup') {
        return false;
    }

    await lookupCode();
    return true;
}

function syncSelectedBatchIdsWithAvailableRows(rows = allBatches) {
    const availableIds = new Set(
        (Array.isArray(rows) ? rows : [])
            .map((row) => String(row?.id || '').trim())
            .filter(Boolean)
    );
    let changed = false;

    Array.from(selectedBatchIds).forEach((batchId) => {
        if (!availableIds.has(String(batchId || '').trim())) {
            selectedBatchIds.delete(batchId);
            changed = true;
        }
    });

    if (changed) {
        updateSelectedCount();
    }

    return changed;
}

function getPointsBatchLoadFailureMessage(error = null) {
    const rawMessage = String(error?.message || '').trim();
    if (!rawMessage) {
        return '批次详情加载失败，请稍后重试。';
    }

    if (/batch not found/i.test(rawMessage) || /not found/i.test(rawMessage)) {
        return '当前站点下未找到这个批次，可能已删除或刚切换了站点。';
    }

    return `批次详情加载失败：${rawMessage}`;
}

function buildPointsBatchCodesLoadFailureMarkup(message = '', detail = '') {
    const normalizedMessage = String(message || '').trim() || '批次详情加载失败';
    const normalizedDetail = String(detail || '').trim();

    return `
        <div class="points-batch-codes-table-empty">
            <strong>${escapePointsHtml(normalizedMessage)}</strong>
            <span>${escapePointsHtml(normalizedDetail || '可以返回批次列表重新打开，或确认当前站点筛选是否正确。')}</span>
        </div>
    `;
}

function buildPointsBatchActionFeedback(action = '', payload = {}, options = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const requestedBatchCount = Math.max(0, Number.parseInt(options.requestedBatchCount, 10) || 0);
    const filteredCount = Math.max(0, Number.parseInt(options.filteredCount, 10) || 0);
    const totalCount = Math.max(0, Number.parseInt(options.totalCount, 10) || 0);
    const exportedCount = Math.max(0, Number.parseInt(options.exportedCount, 10) || 0);
    const missingCount = Math.max(0, Number.parseInt(options.missingCount, 10) || 0);
    const deleteMode = String(payload?.delete_mode || options.deleteMode || '').trim().toLowerCase();
    const deletedBatchCount = Math.max(0, Number.parseInt(payload?.deleted_batch_count, 10) || 0);
    const deletedCodeCount = Math.max(0, Number.parseInt(payload?.deleted_code_count, 10) || 0);
    const revokedCount = Math.max(0, Number.parseInt(payload?.revoked_count, 10) || 0);
    const retainedCount = Math.max(0, Number.parseInt(payload?.retained_code_count, 10) || 0);
    const disabledCodeCount = Math.max(0, Number.parseInt(payload?.disabled_code_count, 10) || 0);
    const skippedBatchCount = Math.max(0, requestedBatchCount - deletedBatchCount);

    if (normalizedAction === 'delete') {
        const stats = [
            { label: '批次', value: requestedBatchCount > 0 ? `${deletedBatchCount}/${requestedBatchCount}` : String(deletedBatchCount) },
            { label: '删码', value: String(deletedCodeCount) }
        ];
        if (revokedCount > 0) {
            stats.push({ label: '撤销', value: String(revokedCount) });
        }
        if (retainedCount > 0) {
            stats.push({ label: '保留', value: String(retainedCount) });
        }
        if (skippedBatchCount > 0) {
            stats.push({ label: '跳过', value: String(skippedBatchCount) });
        }

        let detail = '批次与兑换码记录已同步刷新。';
        if (deleteMode === 'revoke') {
            detail = '已先撤销可回收的已使用兑换码，再执行批次删除。';
        } else if (deleteMode === 'block') {
            detail = retainedCount > 0
                ? '已使用兑换码记录继续保留，用于后续审计追踪。'
                : '选中批次里没有已使用兑换码，所有记录都已直接清理。';
        } else if (deleteMode === 'keep') {
            detail = '用户已获得的积分保持不变，仅清理后台批次和兑换码记录。';
        }

        return {
            message: String(payload?.message || '批次已处理').trim(),
            tone: 'success',
            detail,
            stats
        };
    }

    if (normalizedAction === 'invalidate') {
        return {
            message: disabledCodeCount > 0
                ? String(payload?.message || `已作废 ${disabledCodeCount} 个未使用兑换码`).trim()
                : '选中批次里没有可作废的未使用兑换码',
            tone: disabledCodeCount > 0 ? 'success' : 'info',
            detail: requestedBatchCount > 0
                ? `已检查 ${requestedBatchCount} 个批次，仅处理状态仍为“未使用”的兑换码。`
                : '当前没有可处理的批次。',
            stats: [
                { label: '批次', value: String(requestedBatchCount || 0) },
                { label: '作废', value: String(disabledCodeCount) }
            ]
        };
    }

    if (normalizedAction === 'export-all') {
        const stats = [
            { label: '导出', value: String(totalCount) }
        ];
        if (filteredCount > 0 && filteredCount !== totalCount) {
            stats.push({ label: '筛中', value: String(filteredCount) });
        }
        return {
            message: `已导出 ${totalCount} 个批次`,
            tone: 'success',
            detail: filteredCount > 0 && filteredCount !== totalCount
                ? `当前列表命中 ${filteredCount} 个批次，本次导出仍包含全部 ${totalCount} 个批次。`
                : '导出文件已保存到本地下载目录。',
            stats
        };
    }

    if (normalizedAction === 'export-selected') {
        const stats = [
            { label: '选中', value: String(requestedBatchCount || 0) },
            { label: '导出', value: String(exportedCount) }
        ];
        if (missingCount > 0) {
            stats.push({ label: '跳过', value: String(missingCount) });
        }
        return {
            message: `已导出 ${exportedCount} 个选中批次`,
            tone: missingCount > 0 ? 'warning' : 'success',
            detail: missingCount > 0
                ? `有 ${missingCount} 个选中批次在当前列表中已不存在，导出时已自动跳过。`
                : '每个批次会在导出文件里生成一张独立工作表。',
            stats
        };
    }

    return {
        message: String(payload?.message || '').trim(),
        tone: 'info',
        detail: '',
        stats: []
    };
}

async function syncCurrentPointsBatchDetailAfterListReload({ onMissing = null } = {}) {
    const currentBatchId = String(window.currentViewBatchId || '').trim();
    if (!currentBatchId) {
        return false;
    }

    const batchStillExists = allBatches.some((row) => String(row?.id || '').trim() === currentBatchId);
    if (batchStillExists) {
        return viewBatchCodes(currentBatchId);
    }

    closeCodesModal();
    if (typeof onMissing === 'function') {
        onMissing(currentBatchId);
    }
    return false;
}

function dismissPointsSiteScopedOverlaysOnSiteChange() {
    const dismissed = [];

    if (document.querySelector('.delete-options-modal-overlay')) {
        closeDeleteOptionsModal();
        dismissed.push('批次删除');
    }

    if (document.getElementById('batchEditForm')) {
        closeBatchEditModal();
        dismissed.push('批次编辑');
    }

    if (document.querySelector('.points-code-action-modal-overlay')) {
        closePointsCodeActionModal();
        dismissed.push('兑换码操作');
    }

    if (document.querySelector('.points-batch-invalidate-modal-overlay')) {
        closePointsBatchInvalidateModal();
        dismissed.push('批次作废');
    }

    if (document.querySelector('.points-package-delete-modal-overlay')) {
        closePointsPackageDeleteModal();
        dismissed.push('套餐删除');
    }

    return dismissed;
}

function announcePointsScopedAction(message = '', tone = 'success', {
    sourceEl = null,
    lookup = false,
    batch = false,
    batchList = false,
    batchId = ''
} = {}) {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return;
    }

    let delivered = false;
    const normalizedBatchId = String(batchId || window.currentViewBatchId || pointsBatchCodesUiState.batchId || '').trim();
    const sourceInLookup = Boolean(sourceEl?.closest?.('#lookupResult'));
    const sourceInBatch = Boolean(sourceEl?.closest?.('.codes-modal'));
    const sourceInBatchList = Boolean(sourceEl?.closest?.('#points-view-batches'));
    const hasSourceContext = Boolean(sourceEl);
    const inLookup = lookup
        || sourceInLookup
        || (!hasSourceContext && getActivePointsViewName() === 'lookup' && Boolean(document.getElementById('pointsLookupInlineFeedback')));
    const inBatch = batch
        || sourceInBatch
        || (!hasSourceContext && normalizedBatchId && Boolean(document.getElementById('pointsBatchCodesInlineFeedback')));
    const inBatchList = batchList
        || sourceInBatchList
        || (!hasSourceContext && getActivePointsViewName() === 'batches' && Boolean(document.getElementById('pointsBatchListInlineFeedback')));

    if (inLookup) {
        setPointsLookupFeedback(normalizedMessage, tone);
        delivered = true;
    } else if (inBatch && normalizedBatchId) {
        setPointsBatchCodesFeedback(normalizedMessage, tone, normalizedBatchId);
        delivered = true;
    } else if (inBatchList) {
        setPointsBatchListFeedback(normalizedMessage, tone, 'action');
        delivered = true;
    }

    if (!delivered) {
        announcePointsAction(normalizedMessage, tone);
    }
}

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

function getPointsCatalogToolbarElements() {
    return {
        searchInput: document.getElementById('pointsCatalogSearchInput'),
        statusInput: document.getElementById('pointsCatalogStatusFilter'),
        sortInput: document.getElementById('pointsCatalogSortFilter'),
        countEl: document.getElementById('pointsCatalogPackageCount'),
        tbody: document.getElementById('pointsPackagesTableBody')
    };
}

function getPointsGenerateFormElements() {
    const form = document.getElementById('generateCodesForm');
    return {
        form,
        batchNameInput: document.getElementById('batchName'),
        packageInput: document.getElementById('batchPackageId'),
        countInput: document.getElementById('batchCount'),
        channelInput: document.getElementById('batchChannel'),
        expiresInput: document.getElementById('batchExpires'),
        customPointsInput: document.getElementById('customPointsAmount'),
        previewRoot: document.getElementById('pointsGeneratePreview'),
        previewStatus: document.getElementById('pointsGeneratePreviewStatus'),
        previewSummary: document.getElementById('pointsGeneratePreviewSummary'),
        previewMeta: document.getElementById('pointsGeneratePreviewMeta'),
        previewWarnings: document.getElementById('pointsGeneratePreviewWarnings'),
        resultMeta: document.getElementById('generatedCodesMeta'),
        writeContextRoot: document.getElementById('pointsGenerateWriteContext'),
        submitBtn: form?.querySelector('button[type="submit"]') || null
    };
}

function formatPointsGenerateSiteLabel(site = '') {
    const normalizedSite = String(site || '').trim().toLowerCase();
    if (normalizedSite === 'cn') return 'CN 站点';
    if (normalizedSite === 'intl') return 'INTL 站点';
    return '全部站点';
}

function formatPointsGenerateChannelLabel(channel = '') {
    const labels = {
        xianyu: '闲鱼',
        taobao: '淘宝',
        manual: '手动发放',
        promotion: '促销活动',
        test: '内部测试'
    };
    return labels[String(channel || '').trim().toLowerCase()] || '未设置';
}

function getPointsWriteContextState() {
    const readSite = getPointsReadSite();
    const canWrite = readSite === 'cn' || readSite === 'intl';
    const readLabel = formatPointsGenerateSiteLabel(readSite);

    return {
        readSite,
        canWrite,
        readLabel,
        writeLabel: canWrite ? readLabel : '请选择 CN / INTL',
        tone: canWrite ? 'ready' : 'blocked'
    };
}

function buildPointsSiteContextMarkup(mode = 'catalog') {
    const context = getPointsWriteContextState();
    const helperText = mode === 'generate'
        ? (context.canWrite
            ? '本次生成的兑换码、批次和后续查询都会归属到当前站点。'
            : '生成兑换码属于写入操作，请先把顶部站点筛选切到 CN 或 INTL。')
        : (mode === 'batch'
            ? (context.canWrite
                ? '批次元信息、未使用兑换码作废和单码状态调整都会落到当前站点；这不会改动已发出的积分流水。'
                : '批次与兑换码写操作需要明确站点，请先把顶部站点筛选切到 CN 或 INTL。')
            : (context.canWrite
                ? '套餐资产仍是全局共享的，但保存和删除动作会落到当前站点语境。'
                : '套餐可跨站点复用，但保存和删除前仍需先把顶部站点筛选切到 CN 或 INTL。'));

    return `
        <div class="points-site-context__main">
            <div class="points-site-context__item">
                <span>当前读取</span>
                <strong>${escapePointsHtml(context.readLabel)}</strong>
            </div>
            <div class="points-site-context__item ${context.canWrite ? 'is-ready' : 'is-blocked'}">
                <span>实际写入</span>
                <strong>${escapePointsHtml(context.writeLabel)}</strong>
            </div>
        </div>
        <div class="points-site-context__note">${escapePointsHtml(helperText)}</div>
    `;
}

function formatPointsGenerateDateTime(value = '') {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return '未设置';
    }

    const date = new Date(normalizedValue.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) {
        return normalizedValue;
    }

    return date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getPointsBatchInsights(batch = {}, referenceDate = new Date()) {
    const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const createdAt = new Date(batch.created_at);
    const expiresAt = batch.expires_at ? new Date(batch.expires_at) : null;
    const hasValidCreatedAt = !Number.isNaN(createdAt.getTime());
    const hasValidExpiry = expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime());
    const totalCount = Math.max(0, Number(batch.total_count) || 0);
    const usedCount = Math.max(0, Number(batch.used_count) || 0);
    const usageRate = totalCount > 0 ? (usedCount / totalCount) : 0;
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const expiringThreshold = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    return {
        createdAt,
        expiresAt,
        totalCount,
        usedCount,
        usageRate,
        hasValidCreatedAt,
        hasValidExpiry,
        isToday: hasValidCreatedAt && createdAt >= startOfDay,
        isExpiringSoon: hasValidExpiry && expiresAt >= now && expiresAt <= expiringThreshold,
        isLowUsage: totalCount >= 5 && usageRate <= 0.2,
        isManual: String(batch.channel || '') === 'manual',
        isCustom: Math.max(0, Number(batch.custom_points_amount) || 0) > 0
    };
}

function formatPointsBatchExpiryLabel(batch = {}, insights = getPointsBatchInsights(batch)) {
    if (!insights.hasValidExpiry) {
        return '长期有效';
    }

    const deltaMs = insights.expiresAt.getTime() - Date.now();
    if (deltaMs <= 0) {
        return `已过期 · ${formatPointsGenerateDateTime(batch.expires_at)}`;
    }

    const hours = Math.ceil(deltaMs / (60 * 60 * 1000));
    if (hours <= 48) {
        return `${hours} 小时后到期`;
    }

    const days = Math.ceil(deltaMs / (24 * 60 * 60 * 1000));
    return `${days} 天后到期`;
}

function buildPointsBatchRiskBadges(batch = {}) {
    const insights = getPointsBatchInsights(batch);
    const siteLabel = formatPointsGenerateSiteLabel(batch.site || getPointsReadSite()).replace(' 站点', '');
    const badges = [
        `<span class="points-batch-risk points-batch-risk--site">${escapePointsHtml(siteLabel)}</span>`
    ];

    if (insights.isManual) {
        badges.push('<span class="points-batch-risk points-batch-risk--manual">手动</span>');
    }
    if (insights.isCustom) {
        badges.push('<span class="points-batch-risk points-batch-risk--custom">自定义</span>');
    }
    if (insights.isLowUsage) {
        badges.push('<span class="points-batch-risk points-batch-risk--low">低使用率</span>');
    }
    if (insights.isExpiringSoon) {
        badges.push(`<span class="points-batch-risk points-batch-risk--expiring">${escapePointsHtml(formatPointsBatchExpiryLabel(batch, insights))}</span>`);
    }

    return badges.join('');
}

function buildPointsBatchEditOverviewCard({
    iconClass = 'fas fa-layer-group',
    label = '',
    value = '',
    meta = '',
    tone = 'default'
} = {}) {
    return `
        <article class="points-batch-edit-overview-card points-batch-edit-overview-card--${escapePointsHtml(tone)}">
            <span class="points-batch-edit-overview-card__icon"><i class="${escapePointsHtml(iconClass)}"></i></span>
            <div class="points-batch-edit-overview-card__body">
                <span class="points-batch-edit-overview-card__label">${escapePointsHtml(label)}</span>
                <strong class="points-batch-edit-overview-card__value">${escapePointsHtml(value)}</strong>
                ${meta ? `<span class="points-batch-edit-overview-card__meta">${escapePointsHtml(meta)}</span>` : ''}
            </div>
        </article>
    `;
}

function getPointsSelectedPackageData(packageId = '') {
    const normalizedPackageId = String(packageId || '').trim();
    if (!normalizedPackageId || normalizedPackageId === 'custom') {
        return null;
    }

    return getPointsCatalogRows().find((row) => String(row?.id || '') === normalizedPackageId) || null;
}

function buildPointsGeneratePreviewModel() {
    const {
        batchNameInput,
        packageInput,
        countInput,
        channelInput,
        expiresInput,
        customPointsInput
    } = getPointsGenerateFormElements();

    const batchName = String(batchNameInput?.value || '').trim();
    const packageId = String(packageInput?.value || '').trim();
    const isCustomPoints = packageId === 'custom';
    const selectedPackage = getPointsSelectedPackageData(packageId);
    const customPointsAmount = Math.max(0, Math.round(Number(customPointsInput?.value) || 0));
    const pointsPerCode = isCustomPoints
        ? customPointsAmount
        : Math.max(0, Number(selectedPackage?.total_points) || 0);
    const count = Math.max(0, Math.round(Number(countInput?.value) || 0));
    const site = getPointsReadSite();
    const channel = String(channelInput?.value || '').trim();
    const expiresAt = String(expiresInput?.value || '').trim();
    const packageLabel = isCustomPoints
        ? (customPointsAmount > 0 ? `自定义积分 (${customPointsAmount}分)` : '自定义积分')
        : (selectedPackage
            ? `${selectedPackage.name}${selectedPackage.total_points ? ` (${selectedPackage.total_points}分)` : ''}`
            : '未选择套餐');
    const batchLabel = batchName || '未命名批次';
    const totalPoints = pointsPerCode > 0 && count > 0 ? pointsPerCode * count : 0;

    const blockers = [];
    const warnings = [];

    if (site === 'all') {
        blockers.push('顶部站点筛选仍是“全部”，先切到 CN 或 INTL 后才能真正写入生成。');
    }
    if (!batchName) {
        blockers.push('请先填写批次名称，便于后续在批次管理里快速定位。');
    }
    if (!packageId) {
        blockers.push('请选择一个套餐，或者切换到“自定义积分”。');
    }
    if (isCustomPoints && customPointsAmount <= 0) {
        blockers.push('自定义积分模式下，需要填写大于 0 的积分数量。');
    }
    if (!isCustomPoints && packageId && !selectedPackage) {
        blockers.push('当前套餐不存在或尚未加载完成，请重新选择。');
    }
    if (count <= 0) {
        blockers.push('生成数量至少为 1。');
    } else if (count > 200) {
        warnings.push('本次生成数量较大，建议确认是否需要拆分成多个批次，方便后续运营追踪。');
    }
    if (expiresAt) {
        const expiresDate = new Date(expiresAt.replace(' ', 'T'));
        if (Number.isNaN(expiresDate.getTime())) {
            warnings.push('过期时间暂时无法识别，将按原始输入提交。');
        }
    } else {
        warnings.push('当前未设置过期时间，生成的兑换码会长期有效。');
    }

    const statusTone = blockers.length > 0 ? 'blocked' : (warnings.length > 0 ? 'review' : 'ready');
    const statusLabel = blockers.length > 0 ? '待完善' : (warnings.length > 0 ? '可复核' : '可生成');

    return {
        batchLabel,
        batchName,
        packageId,
        packageLabel,
        channel,
        count,
        pointsPerCode,
        totalPoints,
        site,
        expiresAt,
        blockers,
        warnings,
        statusTone,
        statusLabel
    };
}

function renderPointsGeneratePreview() {
    const {
        previewRoot,
        previewStatus,
        previewSummary,
        previewMeta,
        previewWarnings
    } = getPointsGenerateFormElements();

    if (!previewRoot || !previewStatus || !previewSummary || !previewMeta || !previewWarnings) {
        return;
    }

    const model = buildPointsGeneratePreviewModel();
    renderPointsSiteContexts();
    previewRoot.dataset.status = model.statusTone;
    previewStatus.className = `points-generate-preview__status is-${model.statusTone}`;
    previewStatus.textContent = model.statusLabel;

    previewSummary.innerHTML = [
        { label: '写入站点', value: formatPointsGenerateSiteLabel(model.site) },
        { label: '套餐 / 面额', value: model.packageLabel },
        { label: '生成数量', value: model.count > 0 ? `${model.count} 个` : '未填写' },
        { label: '总积分面额', value: model.totalPoints > 0 ? `${model.totalPoints} 分` : '待计算' }
    ].map((item) => `
        <div class="points-generate-preview__item">
            <span>${escapePointsHtml(item.label)}</span>
            <strong>${escapePointsHtml(item.value)}</strong>
        </div>
    `).join('');

    previewMeta.innerHTML = `
        <div class="points-generate-preview__meta-item">
            <span>批次名</span>
            <strong>${escapePointsHtml(model.batchLabel)}</strong>
        </div>
        <div class="points-generate-preview__meta-item">
            <span>销售渠道</span>
            <strong>${escapePointsHtml(formatPointsGenerateChannelLabel(model.channel))}</strong>
        </div>
        <div class="points-generate-preview__meta-item">
            <span>过期时间</span>
            <strong>${escapePointsHtml(formatPointsGenerateDateTime(model.expiresAt))}</strong>
        </div>
        <div class="points-generate-preview__meta-item">
            <span>单码面额</span>
            <strong>${model.pointsPerCode > 0 ? `${escapePointsHtml(model.pointsPerCode)} 分 / 码` : '待确认'}</strong>
        </div>
    `;

    const messages = model.blockers.length ? model.blockers : model.warnings;
    previewWarnings.innerHTML = messages.length
        ? `
            <ul class="points-generate-preview__warning-list">
                ${messages.map((message) => `<li>${escapePointsHtml(message)}</li>`).join('')}
            </ul>
        `
        : '<div class="points-generate-preview__success">配置已经完整，可以直接生成并在结果区导出或回跳到批次管理。</div>';
}

function syncPointsCatalogFilterInputs() {
    const { searchInput, statusInput, sortInput } = getPointsCatalogToolbarElements();
    if (searchInput) searchInput.value = pointsCatalogFilterState.search;
    if (statusInput) statusInput.value = pointsCatalogFilterState.status;
    if (sortInput) sortInput.value = pointsCatalogFilterState.sort;
}

function clearPointsCatalogFilters({ focusSearch = false } = {}) {
    pointsCatalogFilterState = {
        search: '',
        status: 'all',
        sort: 'sort_order_asc'
    };
    syncPointsCatalogFilterInputs();
    if (focusSearch) {
        document.getElementById('pointsCatalogSearchInput')?.focus();
    }
}

function getPointsPackageAggregateMetrics(pkg = {}) {
    const metrics = getPointsPackageMetrics(pkg);
    const fallback = {
        batch_count: (metrics.cn?.batch_count || 0) + (metrics.intl?.batch_count || 0),
        generated_count: (metrics.cn?.generated_count || 0) + (metrics.intl?.generated_count || 0),
        used_count: (metrics.cn?.used_count || 0) + (metrics.intl?.used_count || 0)
    };

    return {
        batch_count: Math.max(0, Number(metrics.total?.batch_count) || fallback.batch_count),
        generated_count: Math.max(0, Number(metrics.total?.generated_count) || fallback.generated_count),
        used_count: Math.max(0, Number(metrics.total?.used_count) || fallback.used_count)
    };
}

function getFilteredPointsCatalogRows(rows = getPointsCatalogRows()) {
    const source = Array.isArray(rows) ? rows.slice() : [];
    const search = String(pointsCatalogFilterState.search || '').trim().toLowerCase();
    const status = String(pointsCatalogFilterState.status || 'all');
    const sort = String(pointsCatalogFilterState.sort || 'sort_order_asc');

    const filtered = source.filter((row) => {
        if (status === 'active' && row.is_active === false) return false;
        if (status === 'inactive' && row.is_active !== false) return false;
        if (!search) return true;

        const haystack = [
            row.name,
            row.name_en,
            row.id
        ].join(' ').toLowerCase();

        return haystack.includes(search);
    });

    const collator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true });

    filtered.sort((a, b) => {
        switch (sort) {
            case 'name_asc':
                return collator.compare(a.name || a.name_en || '', b.name || b.name_en || '');
            case 'points_desc':
                return (Number(b.total_points) || 0) - (Number(a.total_points) || 0);
            case 'price_desc':
                return (Number(b.price_cny) || 0) - (Number(a.price_cny) || 0);
            case 'activity_desc': {
                const aActivity = getPointsPackageAggregateMetrics(a).generated_count;
                const bActivity = getPointsPackageAggregateMetrics(b).generated_count;
                return bActivity - aActivity;
            }
            case 'sort_order_asc':
            default: {
                const sortDelta = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
                if (sortDelta !== 0) return sortDelta;
                return collator.compare(a.name || '', b.name || '');
            }
        }
    });

    return filtered;
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
        writeContextRoot: document.getElementById('pointsCatalogWriteContext'),
        saveBtn: document.getElementById('pointsPackageSaveBtn'),
        deleteBtn: document.getElementById('pointsPackageDeleteBtn')
    };
}

function syncPointsPackageActionState() {
    const { saveBtn, deleteBtn } = getPointsPackageEditorElements();
    const context = getPointsWriteContextState();
    const isEditMode = pointsPackageEditorState.mode === 'edit' && !!getActivePointsPackageRow();
    const blockedTitle = '先把顶部站点筛选切到 CN 或 INTL，再执行写入操作';

    if (saveBtn && saveBtn.dataset.loading !== '1') {
        saveBtn.disabled = !context.canWrite;
        saveBtn.classList.toggle('is-blocked', !context.canWrite);
        saveBtn.title = context.canWrite ? '' : blockedTitle;
    }

    if (deleteBtn) {
        deleteBtn.disabled = !isEditMode || !context.canWrite;
        deleteBtn.classList.toggle('is-blocked', !context.canWrite);
        deleteBtn.title = !context.canWrite
            ? blockedTitle
            : (isEditMode ? '' : '请选择一个已有套餐');
    }
}

function setPointsPackageSaveButtonState(loading, text = '保存套餐') {
    const { saveBtn } = getPointsPackageEditorElements();
    if (!saveBtn) return;
    saveBtn.dataset.loading = loading ? '1' : '0';
    saveBtn.innerHTML = loading
        ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span class="points-package-action-btn__label">保存中...</span>'
        : `<span class="points-package-action-btn__label">${text}</span>`;
    syncPointsPackageActionState();
}

function syncPointsGenerateSubmitState() {
    const { submitBtn } = getPointsGenerateFormElements();
    if (!submitBtn || submitBtn.dataset.loading === '1') {
        return;
    }

    const context = getPointsWriteContextState();
    submitBtn.disabled = !context.canWrite;
    submitBtn.classList.toggle('is-blocked', !context.canWrite);
    submitBtn.title = context.canWrite
        ? ''
        : '先把顶部站点筛选切到 CN 或 INTL，再生成兑换码';
}

function renderPointsSiteContexts() {
    const { writeContextRoot: catalogContextRoot } = getPointsPackageEditorElements();
    const { writeContextRoot: generateContextRoot } = getPointsGenerateFormElements();

    if (catalogContextRoot) {
        catalogContextRoot.innerHTML = buildPointsSiteContextMarkup('catalog');
    }

    if (generateContextRoot) {
        generateContextRoot.innerHTML = buildPointsSiteContextMarkup('generate');
    }

    syncPointsPackageActionState();
    syncPointsGenerateSubmitState();
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
    if (viewName === 'lookup') {
        const resultDiv = document.getElementById('lookupResult');
        if (resultDiv && !String(resultDiv.innerHTML || '').trim()) {
            renderLookupEmptyState();
        }
    }

    schedulePointsViewPrefetch(viewName);
}

function focusPointsAnalyticsTarget(target, block = 'center') {
    const focusTarget = target instanceof HTMLElement
        ? target
        : null;

    document.querySelectorAll('#module-points .analytics-nav-focus-target--active').forEach((element) => {
        element.classList.remove('analytics-nav-focus-target--active');
    });

    if (!(focusTarget instanceof HTMLElement)) {
        return false;
    }

    focusTarget.classList.add('analytics-nav-focus-target--active');
    focusTarget.scrollIntoView({ behavior: 'smooth', block });

    if (pointsAnalyticsFocusTimeoutId) {
        window.clearTimeout(pointsAnalyticsFocusTimeoutId);
    }

    pointsAnalyticsFocusTimeoutId = window.setTimeout(() => {
        focusTarget.classList.remove('analytics-nav-focus-target--active');
    }, 2600);

    return true;
}

function openAnalyticsPointsContext(context = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
        ? context
        : {};
    const batchId = String(normalizedContext.batchId || '').trim();
    const code = String(normalizedContext.code || normalizedContext.focusCode || '').trim();
    const requestedView = String(normalizedContext.view || '').trim().toLowerCase();
    const lookupValue = String(
        normalizedContext.lookupValue
        || normalizedContext.ledgerId
        || normalizedContext.referenceId
        || ''
    ).trim();
    const search = String(
        normalizedContext.search
        || normalizedContext.batchName
        || ''
    ).trim();
    const quick = String(normalizedContext.quick || '').trim().toLowerCase();
    const channel = String(normalizedContext.channel || '').trim().toLowerCase();
    const packageId = String(normalizedContext.packageId || '').trim();
    const date = String(normalizedContext.date || '').trim().toLowerCase();

    if (batchId) {
        navigateToBatch(batchId, code ? { code } : {});
        return true;
    }

    if (lookupValue || requestedView === 'lookup') {
        switchPointsView('lookup');
        window.setTimeout(() => {
            const input = document.getElementById('lookupCodeInput');
            if (input) {
                input.value = lookupValue;
                try {
                    input.focus({ preventScroll: true });
                } catch (_) {
                    input.focus();
                }
            }

            const lookupTask = lookupValue && typeof lookupCode === 'function'
                ? lookupCode()
                : Promise.resolve();
            Promise.resolve(lookupTask).finally(() => {
                const target = document.querySelector('#lookupResult .lookup-card') || document.getElementById('lookupResult');
                focusPointsAnalyticsTarget(target, 'start');
            });
        }, 140);
        return true;
    }

    const nextView = ['catalog', 'generate', 'batches'].includes(requestedView)
        ? requestedView
        : 'batches';

    if (nextView === 'batches' && search) {
        pendingBatchSearchTerm = search;
    }

    switchPointsView(nextView);

    window.setTimeout(() => {
        if (nextView === 'batches') {
            const searchInput = document.getElementById('batchSearchInput');
            if (searchInput && search) {
                searchInput.value = search;
            }
            if (quick) {
                filterBatchByQuick(quick);
            }
            if (date) {
                filterBatchByDate(date);
            }
            if (channel) {
                filterBatchByChannel(channel);
            }
            if (packageId) {
                filterBatchByPackage(packageId);
            }
            if (search && !quick && !date && !channel && !packageId) {
                applyBatchFilters();
            }

            if (searchInput) {
                try {
                    searchInput.focus({ preventScroll: true });
                } catch (_) {
                    searchInput.focus();
                }
            }

            const focusTarget = document.querySelector('#batchesTableBody .points-batch-row') || document.getElementById('points-view-batches');
            focusPointsAnalyticsTarget(focusTarget, 'start');
            return;
        }

        if (nextView === 'catalog') {
            const target = document.getElementById('pointsPackageForm') || document.getElementById('points-view-catalog');
            focusPointsAnalyticsTarget(target, 'start');
            document.getElementById('pointsCatalogSearchInput')?.focus?.();
            return;
        }

        if (nextView === 'generate') {
            const target = document.getElementById('pointsGeneratePreview') || document.getElementById('points-view-generate');
            focusPointsAnalyticsTarget(target, 'start');
            document.getElementById('batchName')?.focus?.();
        }
    }, 180);

    return true;
}

window.switchPointsView = switchPointsView;
window.navigateToBatch = navigateToBatch;
window.openAnalyticsPointsContext = openAnalyticsPointsContext;
window.openPointsPackageEditor = openPointsPackageEditor;
window.loadBatches = loadBatches;
window.closeCodesModal = closeCodesModal;
window.clearPendingPointsBatchOpen = clearPendingPointsBatchOpen;
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
        onChange: function () {
            renderPointsGeneratePreview();
        },
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
let batchQuickFilterValue = 'all';

// Flag to prevent filter during code search
let isCodeSearchInProgress = false;

// Pagination State
let batchCurrentPage = 1;
const batchPageSize = 10;

// All available packages (for filter dropdown)
let allPackages = [];

function syncPointsBatchSelectModeState() {
    const batchView = document.getElementById('points-view-batches');
    if (batchView?.dataset) {
        batchView.dataset.batchSelectMode = batchSelectMode ? 'true' : 'false';
    }
}

function buildPointsBatchLoadingSkeleton(rowCount = batchPageSize) {
    const rows = Math.max(4, Number.parseInt(rowCount, 10) || batchPageSize);
    const showCheckbox = batchSelectMode === true;
    return Array.from({ length: rows }, (_, index) => `
        <tr class="admin-table-skeleton-row points-batch-skeleton-row" aria-hidden="true" data-skeleton-index="${index}">
            ${showCheckbox ? `
            <td>
                <div class="admin-table-skeleton-cell">
                    <span class="admin-skeleton-block admin-skeleton-block--checkbox"></span>
                </div>
            </td>
            ` : ''}
            <td>
                <div class="points-batch-skeleton-stack">
                    <span class="admin-skeleton-block admin-skeleton-block--title points-batch-skeleton-title" style="width:${44 + (index % 3) * 10}%"></span>
                    <span class="points-batch-skeleton-chips">
                        <span class="admin-skeleton-block admin-skeleton-block--pill points-batch-skeleton-chip" style="width:${40 + (index % 2) * 10}px"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--pill points-batch-skeleton-chip" style="width:${56 + ((index + 1) % 3) * 12}px"></span>
                    </span>
                    <span class="admin-skeleton-block admin-skeleton-block--line points-batch-skeleton-meta" style="width:${62 + (index % 3) * 8}%"></span>
                </div>
            </td>
            <td>
                <div class="points-batch-skeleton-stack points-batch-skeleton-stack--compact">
                    <span class="admin-skeleton-block admin-skeleton-block--title points-batch-skeleton-package" style="width:${48 + (index % 2) * 14}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line points-batch-skeleton-subline" style="width:${34 + (index % 3) * 12}%"></span>
                </div>
            </td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--pill points-batch-skeleton-channel" style="width:${52 + (index % 2) * 8}px"></span></div></td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--line points-batch-skeleton-number" style="width:${34 + (index % 2) * 10}px"></span></div></td>
            <td>
                <div class="points-batch-skeleton-usage">
                    <span class="admin-skeleton-block admin-skeleton-block--line points-batch-skeleton-usage-value" style="width:${26 + (index % 2) * 8}px"></span>
                    <span class="admin-skeleton-block points-batch-skeleton-usage-bar" style="width:${48 + (index % 3) * 16}px"></span>
                </div>
            </td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--line points-batch-skeleton-date" style="width:${84 + (index % 3) * 12}px"></span></div></td>
            <td>
                <div class="admin-table-skeleton-cell admin-table-skeleton-actions points-batch-skeleton-actions">
                    <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                </div>
            </td>
        </tr>
    `).join('');
}

function setPointsBatchQuickFilterLoading(loading = true) {
    document.querySelectorAll('#pointsBatchQuickFilters .points-batch-quick-filter').forEach((button, index) => {
        button.classList.toggle('is-loading', loading);
        button.disabled = loading;
        const countEl = button.querySelector('.points-batch-quick-filter__count');
        if (countEl && loading) {
            countEl.innerHTML = `<span class="admin-skeleton-block points-batch-quick-filter__count-skeleton" style="width:${20 + (index % 3) * 4}px"></span>`;
        }
    });
}

function getPointsBatchQuickCounts(rows = allBatches) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const counts = {
        all: sourceRows.length,
        today: 0,
        expiring: 0,
        low_usage: 0,
        manual: 0,
        custom: 0
    };

    sourceRows.forEach((batch) => {
        const insights = getPointsBatchInsights(batch);

        if (insights.isToday) {
            counts.today += 1;
        }
        if (insights.isExpiringSoon) {
            counts.expiring += 1;
        }
        if (insights.isLowUsage) {
            counts.low_usage += 1;
        }
        if (insights.isManual) {
            counts.manual += 1;
        }
        if (insights.isCustom) {
            counts.custom += 1;
        }
    });

    return counts;
}

function updateBatchQuickFilterUI(counts = getPointsBatchQuickCounts()) {
    document.querySelectorAll('#pointsBatchQuickFilters .points-batch-quick-filter').forEach((button) => {
        button.classList.remove('is-loading');
        button.disabled = false;
        button.classList.toggle('is-active', button.dataset.batchQuick === batchQuickFilterValue);
        const countEl = button.querySelector('.points-batch-quick-filter__count');
        if (countEl) {
            const key = String(button.dataset.batchQuick || 'all');
            countEl.textContent = String(counts[key] ?? 0);
        }
    });
}

function filterBatchByQuick(value = 'all') {
    batchQuickFilterValue = String(value || 'all').trim() || 'all';
    updateBatchQuickFilterUI();
    applyBatchFilters();
}

function buildPointsBatchCustomIconMarkup() {
    return `
        <span class="points-batch-overview-card__custom-icon" aria-hidden="true">
            <span class="points-batch-overview-card__custom-stack">
                <span class="points-batch-overview-card__custom-line points-batch-overview-card__custom-line--short"></span>
                <span class="points-batch-overview-card__custom-line points-batch-overview-card__custom-line--mid"></span>
                <span class="points-batch-overview-card__custom-line points-batch-overview-card__custom-line--long"></span>
            </span>
            <span class="points-batch-overview-card__custom-plus"></span>
        </span>
    `;
}

function buildPointsBatchOverviewCard(iconClass, label, value, meta, tone = 'blue', options = {}) {
    const cardClass = String(options.cardClass || '').trim();
    const iconMarkup = String(options.iconMarkup || '').trim() || `<i class="${iconClass}"></i>`;
    return `
        <article class="points-batch-overview-card points-batch-overview-card--${tone}${cardClass ? ` ${cardClass}` : ''}">
            <div class="points-batch-overview-card__icon">${iconMarkup}</div>
            <div class="points-batch-overview-card__body">
                <span class="points-batch-overview-card__label">${escapePointsHtml(label)}</span>
                <strong class="points-batch-overview-card__value">${escapePointsHtml(value)}</strong>
                <span class="points-batch-overview-card__meta">${escapePointsHtml(meta)}</span>
            </div>
        </article>
    `;
}

function buildPointsBatchOverviewLoadingSkeleton(cardCount = 5) {
    const cards = Math.max(4, Number.parseInt(cardCount, 10) || 5);
    const tones = ['blue', 'green', 'amber', 'violet', 'slate'];
    return Array.from({ length: cards }, (_, index) => `
        <article class="points-batch-overview-card points-batch-overview-card--${tones[index % tones.length]} points-batch-overview-card--skeleton" aria-hidden="true">
            <div class="points-batch-overview-card__icon">
                <span class="admin-skeleton-block points-batch-overview-card__icon-skeleton"></span>
            </div>
            <div class="points-batch-overview-card__body">
                <span class="admin-skeleton-block points-batch-overview-card__label-skeleton" style="width:${54 + (index % 3) * 10}%"></span>
                <span class="admin-skeleton-block points-batch-overview-card__value-skeleton" style="width:${34 + (index % 2) * 14}%"></span>
                <span class="admin-skeleton-block points-batch-overview-card__meta-skeleton" style="width:${60 + (index % 3) * 8}%"></span>
            </div>
        </article>
    `).join('');
}

function renderPointsBatchOverviewLoading() {
    const root = document.getElementById('pointsBatchOverview');
    if (!root) {
        return;
    }
    root.innerHTML = buildPointsBatchOverviewLoadingSkeleton();
    setPointsBatchQuickFilterLoading(true);
}

function renderPointsBatchOverview() {
    const root = document.getElementById('pointsBatchOverview');
    if (!root) {
        return;
    }

    const quickCounts = getPointsBatchQuickCounts(allBatches);
    const siteLabel = formatPointsGenerateSiteLabel(getPointsReadSite());
    const totalPages = Math.max(1, Math.ceil(Math.max(0, filteredBatches.length) / batchPageSize));

    root.innerHTML = [
        buildPointsBatchOverviewCard('fas fa-layer-group', '当前站点批次', `${quickCounts.all}`, siteLabel, 'blue'),
        buildPointsBatchOverviewCard('fas fa-filter', '当前筛选命中', `${filteredBatches.length}`, `第 ${Math.min(batchCurrentPage, totalPages)} / ${totalPages} 页`, 'green'),
        buildPointsBatchOverviewCard('fas fa-hourglass-half', '即将过期', `${quickCounts.expiring}`, '未来 7 天内', 'amber'),
        buildPointsBatchOverviewCard('fas fa-signal', '低使用率', `${quickCounts.low_usage}`, '使用率 <= 20%', 'violet'),
        buildPointsBatchOverviewCard('', '自定义积分', `${quickCounts.custom}`, '按自定义面额发放', 'slate', {
            cardClass: 'points-batch-overview-card--custom-points',
            iconMarkup: buildPointsBatchCustomIconMarkup()
        })
    ].join('');

    updateBatchQuickFilterUI(quickCounts);
}

function hasActiveBatchListFilters() {
    const searchTerm = String(document.getElementById('batchSearchInput')?.value || '').trim();
    return Boolean(
        searchTerm ||
        batchDateFilterValue !== 'all' ||
        batchChannelFilterValue !== 'all' ||
        batchPackageFilterValue !== 'all' ||
        batchQuickFilterValue !== 'all'
    );
}

function setPointsSelectDropdownValue(dropdownId = '', value = '', fallbackText = '') {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) {
        return false;
    }

    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');
    const options = dropdown.querySelectorAll('.select-option');
    const normalizedValue = String(value || '').trim();
    const matchedOption = [...options].find((option) => option.dataset.value === normalizedValue) || null;

    if (hiddenInput) {
        hiddenInput.value = normalizedValue;
    }
    if (displayText) {
        displayText.textContent = matchedOption?.textContent || fallbackText || normalizedValue || '请选择';
    }
    options.forEach((option) => {
        option.classList.toggle('selected', option === matchedOption);
    });

    const customWrapper = document.getElementById('customPointsWrapper');
    if (dropdownId === 'packageSelectDropdown' && customWrapper) {
        setAdminPointsVisibility(customWrapper, normalizedValue === 'custom');
    }

    return Boolean(matchedOption || normalizedValue);
}

function resetPointsGenerateResultPanel() {
    const placeholder = document.getElementById('generatePlaceholder');
    const resultDiv = document.getElementById('generatedCodesResult');
    const codesList = document.getElementById('codesListDisplay');
    const { resultMeta } = getPointsGenerateFormElements();

    generatedCodes = [];
    generatedBatchContext = {
        batchName: '',
        count: 0,
        site: '',
        channel: '',
        packageLabel: ''
    };

    if (codesList) {
        codesList.innerHTML = '';
    }
    if (resultMeta) {
        resultMeta.innerHTML = '';
    }
    setAdminPointsVisibility(placeholder, true);
    setAdminPointsPanelVisible(resultDiv, false);
}

function applyPendingGenerateSeed() {
    if (!pendingGenerateSeed) {
        return false;
    }

    const seed = pendingGenerateSeed;
    pendingGenerateSeed = null;

    const batchNameInput = document.getElementById('batchName');
    const countInput = document.getElementById('batchCount');
    const expiresInput = document.getElementById('batchExpires');
    const customPointsInput = document.getElementById('customPointsAmount');

    if (batchNameInput) {
        batchNameInput.value = seed.batchName;
    }
    if (countInput) {
        countInput.value = String(seed.count);
    }
    if (expiresInput) {
        expiresInput.value = '';
    }
    if (customPointsInput) {
        customPointsInput.value = seed.customPointsAmount > 0 ? String(seed.customPointsAmount) : '';
    }

    setPointsSelectDropdownValue('channelSelectDropdown', seed.channel, formatPointsGenerateChannelLabel(seed.channel));

    if (seed.isCustom) {
        setPointsSelectDropdownValue('packageSelectDropdown', 'custom', '✏️ 自定义积分');
    } else {
        const packageText = seed.packageLabel
            ? `${seed.packageLabel}${seed.pointsPerCode > 0 ? ` (${seed.pointsPerCode}分)` : ''}`
            : '请选择套餐';
        setPointsSelectDropdownValue('packageSelectDropdown', seed.packageId, packageText);
    }

    resetPointsGenerateResultPanel();
    renderPointsGeneratePreview();
    batchNameInput?.focus();
    batchNameInput?.select();

    announcePointsAction('已带入当前批次配置，可直接续发', 'success');

    return true;
}

async function loadBatches() {
    const tbody = document.getElementById('batchesTableBody');
    const colCount = batchSelectMode ? 8 : 7;
    const requestId = ++pointsBatchListLoadRequestId;
    syncPointsBatchSelectModeState();
    tbody.innerHTML = buildPointsBatchLoadingSkeleton();
    renderPointsBatchOverviewLoading();
    renderPointsBatchListFeedback();

    try {
        const currentSite = getPointsReadSite();
        const payload = await fetchPointsBatchesPayload({ site: currentSite });
        if (requestId !== pointsBatchListLoadRequestId) {
            return false;
        }
        allBatches = Array.isArray(payload?.batches) ? payload.batches : [];
        syncSelectedBatchIdsWithAvailableRows(allBatches);
        const activeBatchId = String(window.currentViewBatchId || '').trim();
        if (activeBatchId && !allBatches.some((row) => String(row?.id || '').trim() === activeBatchId)) {
            closeCodesModal();
        }

        // Also load packages for filter dropdown (if not already loaded)
        if (allPackages.length === 0) {
            await loadPackagesForFilter();
            if (requestId !== pointsBatchListLoadRequestId) {
                return false;
            }
        }

        const pendingSearch = String(pendingBatchSearchTerm || '').trim();
        const searchInput = document.getElementById('batchSearchInput');
        if (searchInput && pendingSearch) {
            searchInput.value = pendingSearch;
        }

        applyBatchFilters();
        pendingBatchSearchTerm = '';

        if (searchInput && pendingSearch) {
            searchInput.focus();
        }

        // Enable horizontal scroll with mouse wheel (like users module)
        initBatchTableHorizontalScroll();
        return true;

    } catch (err) {
        if (requestId !== pointsBatchListLoadRequestId) {
            return false;
        }
        console.error('Failed to load batches:', err);
        setPointsBatchListFeedback(`加载失败: ${err.message}`, 'error', 'action');
        tbody.innerHTML = `<tr><td colspan="${colCount}" class="error-cell">加载失败: ${err.message}</td></tr>`;
        renderPointsBatchOverview();
        return false;
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
    syncPointsBatchSelectModeState();

    if (filteredBatches.length === 0) {
        if (allBatches.length === 0) {
            setPointsBatchListFeedback('当前站点还没有批次数据，可以前往“生成兑换码”创建第一批。', 'info', 'empty');
        } else if (hasActiveBatchListFilters()) {
            setPointsBatchListFeedback('当前筛选下没有匹配批次，可调整搜索、筛选或快筛条件。', 'info', 'empty');
        }
        tbody.innerHTML = `
            <tr>
                <td colspan="${colCount}" class="empty-cell">
                    <div class="points-batch-empty-state">
                        <strong>当前筛选下没有匹配批次</strong>
                        <span>试试清空上方搜索 / 筛选，或者切换到其他快筛再看一眼。</span>
                    </div>
                </td>
            </tr>
        `;
        renderPointsBatchOverview();
        updatePaginationUI();
        return;
    }

    if (pointsBatchListFeedbackState.kind === 'empty') {
        clearPointsBatchListFeedback('empty');
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
        const insights = getPointsBatchInsights(batch);
        const usedPercent = insights.totalCount > 0 ? Math.round((insights.usedCount / insights.totalCount) * 100) : 0;
        const createdAt = new Date(batch.created_at).toLocaleString('zh-CN', {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const expiryMeta = formatPointsBatchExpiryLabel(batch, insights);
        const riskBadges = buildPointsBatchRiskBadges(batch);
        const packageLabel = pkg?.name || (insights.isCustom ? '自定义积分' : '-');
        const pointsPerCode = Math.max(0, Number(batch.custom_points_amount) || Number(pkg?.points_amount) || 0);
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
                <td>
                    <div class="points-batch-name-cell">
                        <strong>${escapePointsHtml(batch.name || '-')}</strong>
                        <div class="points-batch-risk-row">${riskBadges}</div>
                        <span class="points-batch-meta-text">创建于 ${escapePointsHtml(createdAt)}${expiryMeta ? ` · ${escapePointsHtml(expiryMeta)}` : ''}</span>
                    </div>
                </td>
                <td>
                    <div class="points-batch-package-cell">
                        <strong>${escapePointsHtml(packageLabel)}</strong>
                        <span>${pointsPerCode > 0 ? `${escapePointsHtml(pointsPerCode)} 分 / 码` : '面额未设置'}</span>
                    </div>
                </td>
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
                    <div class="points-batch-actions">
                        <button class="btn-icon" type="button" data-points-action="open-batch-edit" data-batch-id="${encodeURIComponent(batch.id)}" title="编辑批次">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon" type="button" data-points-action="export-batch-codes" data-batch-id="${encodeURIComponent(batch.id)}" title="导出Excel">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="btn-icon" type="button" data-points-action="reissue-batch" data-batch-id="${encodeURIComponent(batch.id)}" title="续发同类批次">
                            <i class="fas fa-wand-magic-sparkles"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    hydratePointsUsageFills(tbody);
    renderPointsBatchOverview();
    updatePaginationUI();
    updateSelectAllCheckbox();
}

function buildPointsCatalogSummaryCard(iconClass, label, value, tone = 'default') {
    return `
        <article class="points-catalog-summary-card points-catalog-summary-card--${tone} payments-kpi-card payments-kpi-card-visual">
            <div class="payments-kpi-main">
                <div class="kpi-icon points-catalog-summary-card__icon"><i class="${iconClass}"></i></div>
                <div class="kpi-content points-catalog-summary-card__body">
                    <div class="payments-kpi-value points-catalog-summary-card__value">${value}</div>
                    <div class="payments-kpi-label points-catalog-summary-card__label">${label}</div>
                </div>
            </div>
        </article>
    `;
}

function buildPointsCatalogSummaryLoadingSkeleton(cardCount = 6) {
    const cards = Math.max(4, Number.parseInt(cardCount, 10) || 6);
    const tones = ['blue', 'green', 'amber', 'violet', 'rose', 'slate'];
    return Array.from({ length: cards }, (_, index) => `
        <article class="points-catalog-summary-card points-catalog-summary-card--${tones[index % tones.length]} points-catalog-summary-card--skeleton payments-kpi-card payments-kpi-card-visual" aria-hidden="true">
            <div class="payments-kpi-main">
                <div class="kpi-icon points-catalog-summary-card__icon">
                    <span class="admin-skeleton-block points-catalog-summary-card__icon-skeleton"></span>
                </div>
                <div class="kpi-content points-catalog-summary-card__body">
                    <span class="admin-skeleton-block points-catalog-summary-card__value-skeleton" style="width:${40 + (index % 3) * 10}%"></span>
                    <span class="admin-skeleton-block points-catalog-summary-card__label-skeleton" style="width:${62 + (index % 2) * 10}%"></span>
                </div>
            </div>
        </article>
    `).join('');
}

function buildPointsPackageMetricSkeleton() {
    return `
        <div class="points-package-metric-cell points-package-metric-cell--skeleton" aria-hidden="true">
            ${Array.from({ length: 3 }, (_, index) => `
                <span class="points-package-metric-pill points-package-metric-pill--skeleton">
                    <span class="admin-skeleton-block points-package-metric-pill__value-skeleton" style="width:${42 + index * 6}%"></span>
                    <span class="admin-skeleton-block points-package-metric-pill__label-skeleton" style="width:${54 + index * 4}%"></span>
                </span>
            `).join('')}
        </div>
    `;
}

function buildPointsPackageCatalogLoadingSkeleton(rowCount = 6) {
    const rows = Math.max(4, Number.parseInt(rowCount, 10) || 6);
    return Array.from({ length: rows }, (_, index) => `
        <tr class="admin-table-skeleton-row points-package-skeleton-row" aria-hidden="true" data-skeleton-index="${index}">
            <td>
                <div class="points-package-skeleton-stack">
                    <span class="admin-skeleton-block admin-skeleton-block--title points-package-skeleton-title" style="width:${52 + (index % 2) * 14}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line points-package-skeleton-subline" style="width:${38 + (index % 3) * 12}%"></span>
                </div>
            </td>
            <td>
                <div class="points-package-skeleton-stack">
                    <span class="admin-skeleton-block admin-skeleton-block--title points-package-skeleton-balance" style="width:${44 + (index % 3) * 12}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line points-package-skeleton-subline" style="width:${62 + (index % 2) * 10}%"></span>
                </div>
            </td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--line points-package-skeleton-price" style="width:${48 + (index % 2) * 10}px"></span></div></td>
            <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--pill points-package-skeleton-status" style="width:${58 + (index % 2) * 10}px"></span></div></td>
            <td>${buildPointsPackageMetricSkeleton()}</td>
            <td>${buildPointsPackageMetricSkeleton()}</td>
            <td>
                <div class="admin-table-skeleton-cell admin-table-skeleton-actions points-package-skeleton-actions">
                    <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                </div>
            </td>
        </tr>
    `).join('');
}

function formatPointsPackageMetricCell(metric = {}) {
    const safeMetric = metric && typeof metric === 'object' ? metric : {};
    const batchCount = Math.max(0, Number(safeMetric.batch_count) || 0);
    const generatedCount = Math.max(0, Number(safeMetric.generated_count) || 0);
    const usedCount = Math.max(0, Number(safeMetric.used_count) || 0);

    return `
        <div class="points-package-metric-cell">
            <span class="points-package-metric-pill">
                <strong>${batchCount}</strong>
                <span>批次</span>
            </span>
            <span class="points-package-metric-pill">
                <strong>${generatedCount}</strong>
                <span>发码</span>
            </span>
            <span class="points-package-metric-pill">
                <strong>${usedCount}</strong>
                <span>已用</span>
            </span>
        </div>
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
            : '创建一条新的全局套餐。也可以先从下方套餐列表切换编辑对象，保存时仍要求你先在顶部站点筛选中选择 cn 或 intl。';
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
    renderPointsSiteContexts();
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

function duplicatePointsPackageToEditor(packageId = '') {
    const row = getPointsPackageById(packageId);
    if (!row) return;

    setPointsPackageEditorState('create', '');
    renderPointsPackageEditor();

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

    const sourceMetrics = getPointsPackageMetrics(row);

    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = row.name ? `${row.name} 副本` : '未命名套餐 副本';
    if (nameEnInput) nameEnInput.value = row.name_en ? `${row.name_en} Copy` : '';
    if (basePointsInput) basePointsInput.value = String(Math.max(0, Number(row.points_amount) || 0));
    if (bonusPointsInput) bonusPointsInput.value = String(Math.max(0, Number(row.bonus_points) || 0));
    if (priceInput) priceInput.value = row.price_cny == null ? '' : String(row.price_cny);
    if (sortInput) sortInput.value = String(getNextPointsPackageSortOrder());
    if (enabledInput) enabledInput.checked = row.is_active !== false;
    if (modeBadge) modeBadge.textContent = '复制新建';
    if (hint) {
        hint.textContent = `已复制「${row.name || '未命名套餐'}」的配置，请确认名称与写入站点后再保存。`;
    }
    if (metrics) {
        metrics.innerHTML = `
            <div class="points-package-editor-metric">
                <span class="label">参考 CN 表现</span>
                <span class="value">${formatPointsPackageMetricText(sourceMetrics.cn)}</span>
            </div>
            <div class="points-package-editor-metric">
                <span class="label">参考 INTL 表现</span>
                <span class="value">${formatPointsPackageMetricText(sourceMetrics.intl)}</span>
            </div>
        `;
    }
    if (deleteBtn) deleteBtn.disabled = true;

    setPointsPackageSaveButtonState(false, '创建套餐');
    renderPointsSiteContexts();
    nameInput?.focus();
    nameInput?.select();
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

        announcePointsAction(isCreate ? '套餐已创建' : '套餐已保存', 'success');
    } catch (error) {
        console.error('Failed to save points package:', error);
        announcePointsAction(`保存套餐失败: ${error.message}`, 'error');
    } finally {
        setPointsPackageSaveButtonState(
            false,
            pointsPackageEditorState.mode === 'edit' && pointsPackageEditorState.packageId ? '保存套餐' : '创建套餐'
        );
    }
}

async function deleteCurrentPointsPackage() {
    const row = getActivePointsPackageRow();
    if (!row) return;

    openPointsPackageDeleteModal(row.id);
}

function getPointsPackageDeleteModalPayload(packageId = '') {
    const row = getPointsPackageById(packageId) || getActivePointsPackageRow();
    if (!row) {
        return null;
    }

    const metrics = getPointsPackageMetrics(row);
    return {
        row,
        metrics,
        packageId: row.id,
        packageLabel: row.name || '未命名套餐',
        packageMeta: `${Math.max(0, Number(row.total_points) || 0)} 积分 · ${row.price_cny == null ? '未设置价格' : `¥${Number(row.price_cny).toFixed(2)}`}`
    };
}

function syncPointsPackageDeleteModalState() {
    const contextRoot = document.getElementById('pointsPackageDeleteWriteContext');
    const submitBtn = document.getElementById('pointsPackageDeleteSubmitBtn');
    const context = getPointsWriteContextState();

    if (contextRoot) {
        contextRoot.innerHTML = buildPointsSiteContextMarkup('catalog');
    }

    if (submitBtn) {
        submitBtn.disabled = !context.canWrite || pointsPackageDeleteModalState.submitting;
    }
}

function closePointsPackageDeleteModal(event) {
    if (!event || event.target.classList.contains('edit-modal-overlay')) {
        const overlay = document.querySelector('.points-package-delete-modal-overlay');
        if (!overlay) {
            return;
        }

        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            overlay.remove();
        }, 260);
        pointsPackageDeleteModalState = {
            packageId: '',
            submitting: false
        };
    }
}

function openPointsPackageDeleteModal(packageId = '') {
    const payload = getPointsPackageDeleteModalPayload(packageId);
    if (!payload) {
        announcePointsAction('未找到要删除的套餐', 'error');
        return;
    }

    document.querySelector('.points-package-delete-modal-overlay')?.remove();
    pointsPackageDeleteModalState = {
        packageId: payload.packageId,
        submitting: false
    };

    const modalHtml = `
        <div class="edit-modal-overlay points-package-delete-modal-overlay" data-points-overlay-close="package-delete">
            <div class="edit-modal edit-modal--code-action edit-modal--package-delete">
                <div class="edit-modal-header">
                    <div class="edit-modal-header__copy">
                        <span class="edit-modal-header__eyebrow">套餐目录</span>
                        <h3>删除套餐</h3>
                        <p>删除后，该套餐将无法继续用于新批次生成或前台购买入口；历史兑换码与流水不会被追溯删除。</p>
                    </div>
                    <button class="edit-modal-close" type="button" data-points-action="close-package-delete-modal">✕</button>
                </div>
                <form class="edit-modal-form points-code-action-form" data-points-submit="submit-package-delete">
                    <section class="points-code-action-summary points-code-action-summary--danger">
                        <div class="points-code-action-summary__icon"><i class="fas fa-trash"></i></div>
                        <div class="points-code-action-summary__copy">
                            <span class="points-code-action-summary__eyebrow">即将删除</span>
                            <strong class="points-code-action-summary__code">${escapePointsHtml(payload.packageLabel)}</strong>
                            <p>${escapePointsHtml(payload.packageMeta)}</p>
                        </div>
                    </section>
                    <div class="points-site-context points-site-context--code-action" id="pointsPackageDeleteWriteContext">
                        ${buildPointsSiteContextMarkup('catalog')}
                    </div>
                    <section class="points-package-delete-summary">
                        <div class="points-package-delete-summary__meta">
                            <article class="points-package-delete-summary__meta-item">
                                <span>CN 运营表现</span>
                                <strong>${escapePointsHtml(formatPointsPackageMetricText(payload.metrics.cn))}</strong>
                            </article>
                            <article class="points-package-delete-summary__meta-item">
                                <span>INTL 运营表现</span>
                                <strong>${escapePointsHtml(formatPointsPackageMetricText(payload.metrics.intl))}</strong>
                            </article>
                            <article class="points-package-delete-summary__meta-item">
                                <span>启用状态</span>
                                <strong>${escapePointsHtml(payload.row.is_active !== false ? '启用中' : '已停用')}</strong>
                            </article>
                        </div>
                        <div class="points-package-delete-warning">
                            如果只是想暂时停止售卖，优先考虑保留套餐并关闭“启用状态”，这样历史结构和后续审计会更完整。
                        </div>
                    </section>
                    <div class="points-code-action-actions">
                        <button class="points-code-action-cancel" type="button" data-points-action="close-package-delete-modal">取消</button>
                        <button class="points-code-action-submit points-code-action-submit--danger" type="submit" id="pointsPackageDeleteSubmitBtn">
                            <i class="fas fa-trash"></i>
                            <span>确认删除套餐</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const overlay = document.querySelector('.points-package-delete-modal-overlay');
    if (overlay) {
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });
    }

    syncPointsPackageDeleteModalState();
}

async function submitPointsPackageDelete(event) {
    event.preventDefault();

    const packageId = String(pointsPackageDeleteModalState.packageId || '').trim();
    if (!packageId) {
        return;
    }

    try {
        pointsPackageDeleteModalState.submitting = true;
        syncPointsPackageDeleteModalState();
        const result = await mutatePointsPackage({
            method: 'DELETE',
            id: packageId,
            label: '删除套餐'
        });

        if (!result) {
            pointsPackageDeleteModalState.submitting = false;
            syncPointsPackageDeleteModalState();
            return;
        }

        closePointsPackageDeleteModal();
        await reloadPointsCatalogAfterMutation({ nextMode: 'create' });
        announcePointsAction('套餐已删除', 'success');
    } catch (error) {
        console.error('Failed to delete points package:', error);
        pointsPackageDeleteModalState.submitting = false;
        syncPointsPackageDeleteModalState();
        announcePointsAction(`删除套餐失败: ${error.message}`, 'error');
    }
}

function renderPointsPackageCatalogTable(rows = getPointsCatalogRows()) {
    const { countEl, tbody } = getPointsCatalogToolbarElements();
    if (!tbody) return;

    const sourceRows = Array.isArray(rows) ? rows : [];
    const visibleRows = getFilteredPointsCatalogRows(sourceRows);

    if (countEl) {
        countEl.textContent = visibleRows.length === sourceRows.length
            ? `${sourceRows.length} 个套餐`
            : `${visibleRows.length} / ${sourceRows.length} 个套餐`;
    }

    if (!visibleRows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-cell">
                    <div class="points-package-empty-state">
                        <strong>当前筛选下没有匹配套餐</strong>
                        <span>试试清空筛选、切换状态，或者换个关键词。</span>
                        <button class="btn-secondary points-package-empty-state__reset" type="button" data-points-action="clear-package-filters">
                            清空筛选
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = visibleRows.map((pkg) => {
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
                        <strong>${totalPoints} 积分</strong>
                        <span>基础 ${pkg.points_amount || 0} / 赠送 ${pkg.bonus_points || 0}</span>
                    </div>
                </td>
                <td>${formatPointsPackagePrice(pkg.price_cny)}</td>
                <td><span class="points-package-status ${statusClass}">${pkg.is_active === false ? '停用' : '启用'}</span></td>
                <td>${formatPointsPackageMetricCell(metrics.cn)}</td>
                <td>${formatPointsPackageMetricCell(metrics.intl)}</td>
                <td class="points-package-actions">
                    <button class="btn-icon" type="button" data-points-action="duplicate-package" data-package-id="${encodeURIComponent(pkg.id)}" title="复制为新套餐">
                        <i class="fas fa-clone"></i>
                    </button>
                    <button class="btn-icon" type="button" data-points-action="edit-package" data-package-id="${encodeURIComponent(pkg.id)}" title="编辑套餐">
                        <i class="fas fa-pen"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPointsPackageCatalog(payload = {}) {
    const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const packages = setPointsCatalogRows(Array.isArray(payload?.packages) ? payload.packages : []);
    const summaryEl = document.getElementById('pointsCatalogSummary');
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

    if (!packages.length) {
        const { countEl, tbody } = getPointsCatalogToolbarElements();
        if (countEl) {
            countEl.textContent = '0 个套餐';
        }
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">暂无套餐目录</td></tr>';
        }
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
    renderPointsPackageCatalogTable(packages);
    renderPointsPackageEditor();
}

async function loadPointsPackageCatalog({ force = false } = {}) {
    const summaryEl = document.getElementById('pointsCatalogSummary');
    const countEl = document.getElementById('pointsCatalogPackageCount');
    const tbody = document.getElementById('pointsPackagesTableBody');
    const currentSite = getPointsReadSite();

    if (summaryEl) {
        summaryEl.innerHTML = buildPointsCatalogSummaryLoadingSkeleton();
    }
    if (countEl) {
        countEl.innerHTML = '<span class="admin-skeleton-block points-catalog-count-skeleton"></span>';
    }
    if (tbody) {
        tbody.innerHTML = buildPointsPackageCatalogLoadingSkeleton();
    }

    try {
        const payload = await fetchPointsCatalogSnapshot({ site: getPointsReadSite(), force });
        renderPointsPackageCatalog(payload);
    } catch (error) {
        console.error('Failed to load points package catalog:', error);
        if (summaryEl) {
            summaryEl.innerHTML = [
                buildPointsCatalogSummaryCard('fas fa-box-open', '套餐总数', '--', 'blue'),
                buildPointsCatalogSummaryCard('fas fa-check-circle', '启用套餐', '--', 'green'),
                buildPointsCatalogSummaryCard('fas fa-layer-group', currentSite === 'all' ? '全部批次' : `${currentSite.toUpperCase()} 批次`, '--', 'amber'),
                buildPointsCatalogSummaryCard('fas fa-ticket-alt', currentSite === 'all' ? '已发兑换码' : `${currentSite.toUpperCase()} 发码`, '--', 'violet'),
                buildPointsCatalogSummaryCard('fas fa-bolt', currentSite === 'all' ? '已使用兑换码' : `${currentSite.toUpperCase()} 已用`, '--', 'rose'),
                buildPointsCatalogSummaryCard('fas fa-pen-ruler', '自定义批次', '--', 'slate')
            ].join('');
        }
        if (countEl) {
            countEl.textContent = '加载失败';
        }
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
        setPointsCatalogRows(Array.isArray(payload?.packages) ? payload.packages : []);
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
        const seeded = applyPendingGenerateSeed();
        if (!seeded) {
            renderPointsGeneratePreview();
        }

    } catch (err) {
        console.error('Failed to load packages:', err);
        displayText.textContent = '加载失败';
        renderPointsGeneratePreview();
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
                renderPointsGeneratePreview();
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
    const selectedPackage = getPointsSelectedPackageData(packageIdValue);
    const previewModel = buildPointsGeneratePreviewModel();

    const isCustomPoints = packageIdValue === 'custom';
    const customPointsAmount = isCustomPoints
        ? parseInt(document.getElementById('customPointsAmount')?.value)
        : null;

    if (previewModel.blockers.length > 0) {
        announcePointsAction(previewModel.blockers[0], 'error');
        renderPointsGeneratePreview();
        return;
    }

    const btn = event.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.dataset.loading = '1';
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
        generatedBatchContext = {
            batchName: payload?.batch_name || batchName,
            count: Number(payload?.count) || count,
            site: currentSite,
            channel,
            packageLabel: isCustomPoints
                ? (customPointsAmount ? `自定义积分 (${customPointsAmount}分)` : '自定义积分')
                : (selectedPackage?.name || previewModel.packageLabel || '未命名套餐')
        };
        displayGeneratedCodes();
        invalidatePointsCatalogSnapshot();

    } catch (err) {
        console.error('Failed to generate codes:', err);
        announcePointsAction(`生成失败: ${err.message}`, 'error');
    } finally {
        btn.dataset.loading = '0';
        btn.innerHTML = originalText;
        syncPointsGenerateSubmitState();
    }
}

function displayGeneratedCodes() {
    const resultDiv = document.getElementById('generatedCodesResult');
    const codesList = document.getElementById('codesListDisplay');
    const { resultMeta } = getPointsGenerateFormElements();

    codesList.innerHTML = generatedCodes.map(code =>
        `<div class="code-item" data-points-action="copy-code-item" data-code="${encodeURIComponent(code)}" title="点击复制"><code>${code}</code></div>`
    ).join('');

    if (resultMeta) {
        const channelLabel = formatPointsGenerateChannelLabel(generatedBatchContext.channel);
        const siteLabel = formatPointsGenerateSiteLabel(generatedBatchContext.site);
        resultMeta.innerHTML = `
            <span>${escapePointsHtml(generatedBatchContext.batchName || '未命名批次')}</span>
            <span>${escapePointsHtml(siteLabel)}</span>
            <span>${escapePointsHtml(channelLabel)}</span>
            <span>${escapePointsHtml(`${generatedBatchContext.count || generatedCodes.length || 0} 个兑换码`)}</span>
        `;
    }

    // Update display logic for 2-column layout
    const placeholder = document.getElementById('generatePlaceholder');
    setAdminPointsVisibility(placeholder, false);

    setAdminPointsPanelVisible(resultDiv, true);
}

function jumpToGeneratedBatch(batchName = generatedBatchContext.batchName) {
    const normalizedBatchName = String(batchName || '').trim();
    if (!normalizedBatchName) {
        return;
    }

    pendingBatchSearchTerm = normalizedBatchName;
    switchPointsView('batches');
}

function seedGenerateFromBatch(batchId = '') {
    const normalizedBatchId = String(batchId || '').trim();
    const batch = allBatches.find((item) => String(item?.id || '') === normalizedBatchId);
    if (!batch) {
        return;
    }

    const pkg = batch.points_packages;
    const packageLabel = pkg?.name || (Math.max(0, Number(batch.custom_points_amount) || 0) > 0 ? '自定义积分' : '未命名套餐');

    pendingGenerateSeed = {
        batchName: `${batch.name || '未命名批次'} 续发`,
        packageId: String(batch.package_id || '').trim(),
        packageLabel,
        channel: String(batch.channel || 'manual').trim() || 'manual',
        count: Math.min(1000, Math.max(1, Number(batch.total_count) || 10)),
        customPointsAmount: Math.max(0, Number(batch.custom_points_amount) || 0),
        pointsPerCode: Math.max(0, Number(batch.custom_points_amount) || Number(pkg?.points_amount) || 0),
        isCustom: Math.max(0, Number(batch.custom_points_amount) || 0) > 0 || !String(batch.package_id || '').trim()
    };

    switchPointsView('generate');
}

function upsertPointsBatchRow(batch = null) {
    if (!batch || typeof batch !== 'object') {
        return null;
    }

    const normalizedBatchId = String(batch.id || '').trim();
    if (!normalizedBatchId) {
        return null;
    }

    const nextRows = allBatches
        .filter((row) => String(row?.id || '').trim() !== normalizedBatchId);
    nextRows.push(batch);
    nextRows.sort((left, right) => {
        const leftTime = new Date(left?.created_at || 0).getTime();
        const rightTime = new Date(right?.created_at || 0).getTime();
        return rightTime - leftTime;
    });
    allBatches = nextRows;

    return allBatches.find((row) => String(row?.id || '').trim() === normalizedBatchId) || batch;
}

// Copy single code to clipboard
function copySingleCode(element, code) {
    copyPointsTextToClipboard(code, {
        successMessage: '兑换码已复制',
        emptyMessage: '没有可复制的兑换码',
        announcer: (message, tone) => announcePointsScopedAction(message, tone, { sourceEl: element })
    }).then((copied) => {
        if (!copied || !element) {
            return;
        }
        element.classList.add('copied');
        setTimeout(() => element.classList.remove('copied'), 1500);
    });
}

function resetPointsBatchCodesUiState(batchId = '') {
    pointsBatchCodesUiState = {
        batchId: String(batchId || ''),
        search: '',
        status: 'all',
        codes: [],
        visibleCodes: [],
        focusCode: ''
    };
}

function queuePointsBatchCodeFocus(batchId = '', code = '') {
    pendingPointsBatchCodeFocus = {
        batchId: String(batchId || '').trim(),
        code: String(code || '').trim()
    };
}

function clearPendingPointsBatchCodeFocus() {
    pendingPointsBatchCodeFocus = {
        batchId: '',
        code: ''
    };
}

function clearPendingPointsBatchOpen() {
    if (pointsPendingBatchOpenHandle) {
        window.clearTimeout(pointsPendingBatchOpenHandle);
    }
    pointsPendingBatchOpenHandle = 0;
    pointsPendingBatchOpenToken += 1;
}

function schedulePointsBatchOpen(batchId = '', { code = '', delayMs = 200 } = {}) {
    const normalizedBatchId = String(batchId || '').trim();
    if (!normalizedBatchId) {
        clearPendingPointsBatchOpen();
        return false;
    }

    const normalizedCode = String(code || '').trim();
    const normalizedDelay = Math.max(0, Number(delayMs) || 0);
    const scheduledSite = getPointsReadSite();

    clearPendingPointsBatchOpen();
    const requestToken = pointsPendingBatchOpenToken;

    pointsPendingBatchOpenHandle = window.setTimeout(() => {
        pointsPendingBatchOpenHandle = 0;
        if (requestToken !== pointsPendingBatchOpenToken) {
            return;
        }
        if (scheduledSite !== getPointsReadSite()) {
            return;
        }
        if (normalizedCode) {
            queuePointsBatchCodeFocus(normalizedBatchId, normalizedCode);
        }
        viewBatchCodes(normalizedBatchId);
    }, normalizedDelay);

    return true;
}

function focusPointsBatchCodeInModal(code = '', { applySearch = false } = {}) {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) {
        return;
    }

    pointsBatchCodesUiState.focusCode = normalizedCode;
    if (applySearch) {
        pointsBatchCodesUiState.search = normalizedCode;
        pointsBatchCodesUiState.status = 'all';
        refreshPointsBatchCodesTableSection();
    }

    const scrollToFocusedRow = () => {
        const row = document.querySelector(`#pointsBatchCodesTableRegion tr[data-code-key="${encodeURIComponent(normalizedCode)}"]`);
        if (!row) {
            return;
        }

        row.classList.add('points-batch-code-row--pulse');
        row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        window.setTimeout(() => {
            row.classList.remove('points-batch-code-row--pulse');
        }, 1800);
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(scrollToFocusedRow);
        });
        return;
    }

    window.setTimeout(scrollToFocusedRow, 80);
}

function getFilteredPointsBatchCodes(codes = pointsBatchCodesUiState.codes) {
    const search = String(pointsBatchCodesUiState.search || '').trim().toLowerCase();
    const status = String(pointsBatchCodesUiState.status || 'all').trim().toLowerCase() || 'all';

    return (Array.isArray(codes) ? codes : []).filter((row) => {
        const rowStatus = String(row?.status || '').trim().toLowerCase();
        if (status !== 'all' && rowStatus !== status) {
            return false;
        }

        if (!search) {
            return true;
        }

        const haystack = [
            row?.code,
            row?.status,
            row?.used_profile?.username,
            row?.used_profile?.email,
            row?.used_by,
            row?.revoker_name,
            row?.revoke_reason,
            row?.batch_name
        ].filter(Boolean).join(' ').toLowerCase();

        return haystack.includes(search);
    });
}

function buildPointsBatchCodesRowActionButton({
    action = '',
    code = '',
    codeExpiry = '',
    iconClass = 'fas fa-arrow-right',
    title = '',
    tone = 'default'
} = {}) {
    const attrs = [
        `data-points-action="${escapePointsHtml(action)}"`,
        `data-code="${encodeURIComponent(code)}"`,
        title ? `title="${escapePointsHtml(title)}"` : ''
    ];

    if (codeExpiry) {
        attrs.push(`data-code-expiry="${encodeURIComponent(codeExpiry)}"`);
    }

    return `
        <button class="points-batch-codes-row-btn points-batch-codes-row-btn--${escapePointsHtml(tone)}" type="button" ${attrs.filter(Boolean).join(' ')}>
            <i class="${escapePointsHtml(iconClass)}"></i>
        </button>
    `;
}

function buildPointsBatchCodesTableSection(codes = pointsBatchCodesUiState.codes) {
    const sourceRows = Array.isArray(codes) ? codes : [];
    const visibleRows = getFilteredPointsBatchCodes(sourceRows);
    const allCounts = getPointsBatchCodeStatusCounts(sourceRows);
    pointsBatchCodesUiState.visibleCodes = visibleRows;

    const statusOptions = [
        ['all', '全部状态'],
        ['pending', '待使用'],
        ['used', '已使用'],
        ['revoked', '已撤销'],
        ['disabled', '已禁用'],
        ['locked', '已锁定'],
        ['expired', '已过期']
    ].map(([value, label]) => `
        <option value="${escapePointsHtml(value)}" ${pointsBatchCodesUiState.status === value ? 'selected' : ''}>${escapePointsHtml(label)}</option>
    `).join('');

    const toolbarHtml = `
        <div class="points-batch-codes-toolbar">
            <label class="points-batch-codes-search" for="pointsBatchCodesSearchInput">
                <i class="fas fa-search"></i>
                <input
                    id="pointsBatchCodesSearchInput"
                    type="search"
                    placeholder="搜索兑换码、用户、撤销原因..."
                    value="${escapePointsHtml(pointsBatchCodesUiState.search || '')}"
                >
            </label>
            <label class="points-batch-codes-filter" for="pointsBatchCodesStatusFilter">
                <span>状态</span>
                <select id="pointsBatchCodesStatusFilter">${statusOptions}</select>
            </label>
            <div class="points-batch-codes-toolbar__meta">${escapePointsHtml(visibleRows.length)} / ${escapePointsHtml(sourceRows.length)} 个结果</div>
            <div class="points-batch-codes-toolbar__actions">
                <button
                    class="points-batch-codes-toolbar-btn"
                    type="button"
                    data-points-action="copy-visible-batch-codes"
                    ${visibleRows.length ? '' : 'disabled'}
                >
                    <i class="fas fa-copy"></i>
                    <span>复制当前结果</span>
                </button>
                <button
                    class="points-batch-codes-toolbar-btn"
                    type="button"
                    data-points-action="clear-batch-code-filters"
                    ${pointsBatchCodesUiState.search || pointsBatchCodesUiState.status !== 'all' ? '' : 'disabled'}
                >
                    <i class="fas fa-rotate-left"></i>
                    <span>清空筛选</span>
                </button>
            </div>
        </div>
    `;

    if (!visibleRows.length) {
        return `
            <section class="points-batch-codes-panel" id="pointsBatchCodesTableRegion">
                <div class="points-batch-codes-panel__header points-batch-codes-panel__header--table">
                    <div class="points-batch-codes-panel__copy">
                        <span class="points-batch-codes-panel__eyebrow">兑换码明细</span>
                        <h4>状态与操作</h4>
                        <p>按兑换码、用户或状态快速筛出你当前要处理的那一批记录。</p>
                    </div>
                </div>
                ${toolbarHtml}
                <div class="points-batch-codes-table-empty">
                    <i class="fas fa-filter-circle-xmark"></i>
                    <strong>当前筛选下没有命中兑换码</strong>
                    <p>可以试试清空关键词，或把状态切回“全部状态”。</p>
                </div>
            </section>
        `;
    }

    const tableHtml = visibleRows.map((c) => {
        const statusMap = {
            pending: '<span class="status-badge pending">⏳ 待使用</span>',
            used: '<span class="status-badge used">✅ 已使用</span>',
            revoked: '<span class="status-badge revoked">❌ 已撤销</span>',
            locked: '<span class="status-badge locked">🔒 已锁定</span>',
            disabled: '<span class="status-badge disabled">🚫 已禁用</span>',
            expired: '<span class="status-badge expired">⌛ 已过期</span>'
        };

        let detailHtml = '-';
        if (c.status === 'used' && c.used_profile) {
            const userName = c.used_profile.username || c.used_profile.email || '未知用户';
            const usedAt = c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : '';
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
                <span class="detail-reason">📝 撤销: ${escapePointsHtml(reason)}</span>
                <span class="detail-revoker">🛡️ 操作者: ${escapePointsHtml(revokerName)}</span>
                <span class="detail-time">🕐 ${escapePointsHtml(revokedAt)}</span>
            </div>`;
        } else if (c.status === 'disabled') {
            detailHtml = '<span class="detail-disabled">管理员禁用</span>';
        }

        const rowActions = [
            buildPointsBatchCodesRowActionButton({
                action: 'copy-code-item',
                code: c.code,
                iconClass: 'fas fa-copy',
                title: '复制兑换码',
                tone: 'default'
            }),
            buildPointsBatchCodesRowActionButton({
                action: 'lookup-code-item',
                code: c.code,
                iconClass: 'fas fa-magnifying-glass',
                title: '跳到查询页',
                tone: 'accent'
            }),
            c.status === 'pending' ? buildPointsBatchCodesRowActionButton({
                action: 'set-code-expiry',
                code: c.code,
                codeExpiry: c.expires_at || '',
                iconClass: 'fas fa-calendar-alt',
                title: '设置有效期',
                tone: 'default'
            }) : '',
            c.status === 'pending' ? buildPointsBatchCodesRowActionButton({
                action: 'disable-code',
                code: c.code,
                iconClass: 'fas fa-ban',
                title: '禁用兑换码',
                tone: 'danger'
            }) : '',
            c.status === 'used' ? buildPointsBatchCodesRowActionButton({
                action: 'revoke-code',
                code: c.code,
                iconClass: 'fas fa-undo',
                title: '撤销兑换',
                tone: 'danger'
            }) : '',
            c.status === 'disabled' ? buildPointsBatchCodesRowActionButton({
                action: 'enable-code',
                code: c.code,
                iconClass: 'fas fa-check',
                title: '重新启用',
                tone: 'success'
            }) : ''
        ].filter(Boolean).join('');

        const expiryText = c.expires_at
            ? `<span class="code-expiry ${new Date(c.expires_at) < new Date() ? 'expired' : ''}">${new Date(c.expires_at).toLocaleDateString('zh-CN')}</span>`
            : '<span class="code-expiry-none">继承批次</span>';
        const isFocused = String(pointsBatchCodesUiState.focusCode || '') === String(c.code || '');

        return `<tr class="code-row ${escapePointsHtml(c.status || '')} ${isFocused ? 'points-batch-code-row--focused' : ''}" data-code-key="${encodeURIComponent(c.code || '')}">
            <td class="code-cell">${escapePointsHtml(c.code || '-')}</td>
            <td>${statusMap[c.status] || escapePointsHtml(c.status || '-')}</td>
            <td>${expiryText}</td>
            <td>${detailHtml}</td>
            <td class="actions-cell">
                <div class="points-batch-codes-row-tools">${rowActions}</div>
            </td>
        </tr>`;
    }).join('');

    return `
        <section class="points-batch-codes-panel" id="pointsBatchCodesTableRegion">
            <div class="points-batch-codes-panel__header points-batch-codes-panel__header--table">
                <div class="points-batch-codes-panel__copy">
                    <span class="points-batch-codes-panel__eyebrow">兑换码明细</span>
                    <h4>状态与操作</h4>
                    <p>在当前批次内就地筛选、复制单码、跳到查询页，或继续执行单码状态操作。</p>
                </div>
                <div class="points-batch-codes-status-row">
                    ${[
                        ['待使用', allCounts.pending, 'pending'],
                        ['已使用', allCounts.used, 'used'],
                        ['已撤销', allCounts.revoked, 'revoked'],
                        ['已禁用', allCounts.disabled, 'disabled'],
                        ['已锁定', allCounts.locked, 'locked'],
                        ['已过期', allCounts.expired, 'expired']
                    ].map(([label, count, tone]) => `
                        <span class="points-batch-codes-status-pill points-batch-codes-status-pill--${escapePointsHtml(tone)}">${escapePointsHtml(label)} ${escapePointsHtml(count)}</span>
                    `).join('')}
                </div>
            </div>
            ${toolbarHtml}
            <div class="points-batch-codes-table-shell">
                <table class="codes-table">
                    <thead><tr><th>兑换码</th><th>状态</th><th>有效期</th><th>详情</th><th>操作</th></tr></thead>
                    <tbody>${tableHtml}</tbody>
                </table>
            </div>
        </section>
    `;
}

function bindPointsBatchCodesTableControls() {
    const searchInput = document.getElementById('pointsBatchCodesSearchInput');
    const statusInput = document.getElementById('pointsBatchCodesStatusFilter');

    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            pointsBatchCodesUiState.search = String(event.target?.value || '');
            refreshPointsBatchCodesTableSection();
        });
    }

    if (statusInput) {
        statusInput.addEventListener('change', (event) => {
            pointsBatchCodesUiState.status = String(event.target?.value || 'all');
            refreshPointsBatchCodesTableSection();
        });
    }
}

function refreshPointsBatchCodesTableSection() {
    const section = document.getElementById('pointsBatchCodesTableRegion');
    if (!section) {
        return;
    }

    section.outerHTML = buildPointsBatchCodesTableSection(pointsBatchCodesUiState.codes);
    bindPointsBatchCodesTableControls();
    const tableShell = document.querySelector('#pointsBatchCodesTableRegion .points-batch-codes-table-shell');
    if (tableShell) {
        enableHorizontalScroll(tableShell);
    }
}

function clearPointsBatchCodeFilters() {
    pointsBatchCodesUiState.search = '';
    pointsBatchCodesUiState.status = 'all';
    pointsBatchCodesUiState.focusCode = '';
    refreshPointsBatchCodesTableSection();
}

function copyVisibleBatchCodes() {
    const codes = pointsBatchCodesUiState.visibleCodes.map((row) => row.code).filter(Boolean);
    copyPointsTextToClipboard(codes.join('\n'), {
        successMessage: `已复制 ${codes.length} 个兑换码`,
        emptyMessage: '当前筛选下没有可复制的兑换码',
        announcer: (message, tone) => announcePointsScopedAction(message, tone, { batch: true })
    });
}

function openPointsLookupFromCode(code = '') {
    if (!String(code || '').trim()) {
        return;
    }

    clearPendingPointsBatchOpen();
    closeCodesModal();
    switchPointsView('lookup');

    const syncLookup = () => {
        const input = document.getElementById('lookupCodeInput');
        if (input) {
            input.value = code;
            input.focus();
            input.select();
        }
        lookupCode();
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(syncLookup);
        return;
    }

    syncLookup();
}

function buildPointsLookupBatchAction(action = '', batchId = '', code = '', label = '前往批次', icon = 'fas fa-box-archive') {
    return buildPointsLookupActionButton({
        action,
        label,
        icon,
        tone: 'default',
        dataAttrs: {
            'data-batch-id': encodeURIComponent(batchId),
            'data-code': code ? encodeURIComponent(code) : ''
        }
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

        if (target.matches('[data-points-overlay-close="package-delete"]')) {
            closePointsPackageDeleteModal();
            return;
        }

        if (target.matches('[data-points-overlay-close="code-action"]')) {
            closePointsCodeActionModal();
            return;
        }

        if (target.matches('[data-points-overlay-close="batch-invalidate"]')) {
            closePointsBatchInvalidateModal();
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
            case 'close-package-delete-modal':
                closePointsPackageDeleteModal();
                break;
            case 'duplicate-package':
                duplicatePointsPackageToEditor(decodeURIComponent(actionEl.dataset.packageId || ''));
                break;
            case 'edit-package':
                openPointsPackageEditor(decodeURIComponent(actionEl.dataset.packageId || ''));
                break;
            case 'delete-current-package':
                deleteCurrentPointsPackage();
                break;
            case 'clear-package-filters':
                clearPointsCatalogFilters({ focusSearch: true });
                renderPointsPackageCatalogTable();
                break;
            case 'filter-batch-quick':
                filterBatchByQuick(actionEl.dataset.batchQuick || 'all');
                break;
            case 'view-batch-codes':
                viewBatchCodes(actionEl.dataset.batchId || actionEl.getAttribute('data-batch-id') || '');
                break;
            case 'open-batch-edit':
                event.stopPropagation();
                openBatchEditModal(decodeURIComponent(actionEl.dataset.batchId || ''), { returnToCodes: false });
                break;
            case 'open-batch-codes-from-edit':
                event.stopPropagation();
                closeBatchEditModal();
                viewBatchCodes(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'open-batch-edit-from-codes':
                event.stopPropagation();
                closeCodesModal();
                openBatchEditModal(decodeURIComponent(actionEl.dataset.batchId || ''), { returnToCodes: true });
                break;
            case 'export-batch-codes':
                event.stopPropagation();
                exportBatchCodes(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'export-batch-codes-from-modal':
                event.stopPropagation();
                exportBatchCodes(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'reissue-batch':
                event.stopPropagation();
                seedGenerateFromBatch(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'reissue-batch-from-edit':
                event.stopPropagation();
                closeBatchEditModal();
                seedGenerateFromBatch(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'reissue-batch-from-codes':
                event.stopPropagation();
                closeCodesModal();
                seedGenerateFromBatch(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'invalidate-batch-from-codes':
                event.stopPropagation();
                invalidateSingleBatch(decodeURIComponent(actionEl.dataset.batchId || ''));
                break;
            case 'copy-visible-batch-codes':
                event.stopPropagation();
                copyVisibleBatchCodes();
                break;
            case 'clear-batch-code-filters':
                event.stopPropagation();
                clearPointsBatchCodeFilters();
                break;
            case 'copy-code-item':
                copySingleCode(actionEl, decodeURIComponent(actionEl.dataset.code || ''));
                break;
            case 'lookup-code-item':
                event.stopPropagation();
                openPointsLookupFromCode(decodeURIComponent(actionEl.dataset.code || ''));
                break;
            case 'jump-generated-batch':
                jumpToGeneratedBatch();
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
                    decodeURIComponent(actionEl.dataset.codeExpiry || ''),
                    actionEl.closest('.codes-modal') ? 'batch-codes' : (actionEl.closest('#lookupResult') ? 'lookup' : '')
                );
                break;
            case 'disable-code':
                disableCode(
                    decodeURIComponent(actionEl.dataset.code || ''),
                    actionEl.closest('.codes-modal') ? 'batch-codes' : (actionEl.closest('#lookupResult') ? 'lookup' : '')
                );
                break;
            case 'revoke-code':
                revokeCode(
                    decodeURIComponent(actionEl.dataset.code || ''),
                    actionEl.closest('.codes-modal') ? 'batch-codes' : (actionEl.closest('#lookupResult') ? 'lookup' : '')
                );
                break;
            case 'enable-code':
                enableCode(
                    decodeURIComponent(actionEl.dataset.code || ''),
                    actionEl.closest('.codes-modal') ? 'batch-codes' : (actionEl.closest('#lookupResult') ? 'lookup' : '')
                );
                break;
            case 'close-batch-edit':
                closeBatchEditModal();
                break;
            case 'close-code-action-modal':
                closePointsCodeActionModal();
                break;
            case 'close-batch-invalidate-modal':
                closePointsBatchInvalidateModal();
                break;
            case 'navigate-batch':
                event.preventDefault();
                navigateToBatch(decodeURIComponent(actionEl.dataset.batchId || ''), {
                    code: decodeURIComponent(actionEl.dataset.code || '')
                });
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
            case 'submit-package-delete':
                submitPointsPackageDelete(event);
                break;
            case 'save-batch-edit':
                saveBatchEdit(event, decodeURIComponent(form.dataset.batchId || ''));
                break;
            case 'submit-code-action':
                submitPointsCodeAction(event);
                break;
            case 'submit-batch-invalidate':
                submitPointsBatchInvalidate(event);
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
        const lookupInput = document.getElementById('lookupCodeInput');
        const catalogSearchInput = document.getElementById('pointsCatalogSearchInput');
        const catalogStatusInput = document.getElementById('pointsCatalogStatusFilter');
        const catalogSortInput = document.getElementById('pointsCatalogSortFilter');
        const {
            batchNameInput,
            packageInput,
            countInput,
            channelInput,
            expiresInput,
            customPointsInput
        } = getPointsGenerateFormElements();

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

        if (lookupInput) {
            lookupInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    lookupCode();
                }
            });
        }

        if (catalogSearchInput) {
            catalogSearchInput.addEventListener('input', (e) => {
                pointsCatalogFilterState.search = String(e.target.value || '').trim();
                renderPointsPackageCatalogTable();
            });
        }

        if (catalogStatusInput) {
            catalogStatusInput.addEventListener('change', (e) => {
                pointsCatalogFilterState.status = String(e.target.value || 'all');
                renderPointsPackageCatalogTable();
            });
        }

        if (catalogSortInput) {
            catalogSortInput.addEventListener('change', (e) => {
                pointsCatalogFilterState.sort = String(e.target.value || 'sort_order_asc');
                renderPointsPackageCatalogTable();
            });
        }

        [batchNameInput, packageInput, countInput, channelInput, expiresInput, customPointsInput]
            .filter(Boolean)
            .forEach((input) => {
                const eventName = input.tagName === 'INPUT' ? 'input' : 'change';
                input.addEventListener(eventName, () => {
                    renderPointsGeneratePreview();
                });
                if (eventName !== 'change') {
                    input.addEventListener('change', () => {
                        renderPointsGeneratePreview();
                    });
                }
            });

        syncPointsCatalogFilterInputs();
        renderPointsSiteContexts();
        renderPointsGeneratePreview();
        renderLookupEmptyState();
        updateBatchQuickFilterUI();

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
    const expiringThreshold = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    updateBatchQuickFilterUI();

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

        // Quick filter
        const totalCount = Math.max(0, Number(batch.total_count) || 0);
        const usedCount = Math.max(0, Number(batch.used_count) || 0);
        const usageRate = totalCount > 0 ? (usedCount / totalCount) : 0;
        const expiresAt = batch.expires_at ? new Date(batch.expires_at) : null;
        const hasValidExpiry = expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime());
        let matchesQuick = true;

        switch (batchQuickFilterValue) {
            case 'today':
                matchesQuick = createdAt >= startOfDay;
                break;
            case 'expiring':
                matchesQuick = hasValidExpiry && expiresAt >= now && expiresAt <= expiringThreshold;
                break;
            case 'low_usage':
                matchesQuick = totalCount >= 5 && usageRate <= 0.2;
                break;
            case 'manual':
                matchesQuick = String(batch.channel || '') === 'manual';
                break;
            case 'custom':
                matchesQuick = Math.max(0, Number(batch.custom_points_amount) || 0) > 0;
                break;
            case 'all':
            default:
                matchesQuick = true;
                break;
        }

        return matchesSearch && matchesDate && matchesChannel && matchesPackage && matchesQuick;
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
            clearPointsBatchListFeedback();
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
            announcePointsScopedAction('未找到该兑换码，请检查输入是否正确', 'error', { batchList: true });
        }
    } catch (err) {
        console.error('Code search failed:', err);
        announcePointsScopedAction(`搜索失败: ${err.message}`, 'error', { batchList: true });
    }
}

// Search for code without opening modal (for real-time input search)
async function searchCodeInBatchesNoModal(code) {
    try {
        const payload = await fetchPointsBatchesPayload({ site: getPointsReadSite(), code });

        if (payload?.batch) {
            clearPointsBatchListFeedback();
            // Found the code - display only this batch in the table
            isCodeSearchInProgress = true;

            filteredBatches = [payload.batch];
            batchCurrentPage = 1;
            renderBatches();

            isCodeSearchInProgress = false;
        } else {
            // Code not found - show empty state
            filteredBatches = [];
            setPointsBatchListFeedback('未找到对应兑换码，可检查输入是否完整，或切换站点后再试。', 'info', 'empty');
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
    syncPointsBatchSelectModeState();

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
    syncPointsBatchSelectModeState();

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
        announcePointsScopedAction('请先选择要删除的批次', 'error', { batchList: true });
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
        announcePointsScopedAction('请选择一个删除选项', 'error', { batchList: true });
        return;
    }

    const btn = document.querySelector('.delete-options-modal .btn-danger');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';

    try {
        const activeBatchId = String(window.currentViewBatchId || '').trim();
        const payload = await mutatePointsManage({
            action: 'delete_batches',
            site: writableSite,
            payload: {
                batch_ids: batchIds,
                delete_mode: selectedOption
            }
        });

        const feedback = buildPointsBatchActionFeedback('delete', payload, {
            requestedBatchCount: batchIds.length,
            deleteMode: selectedOption
        });

        closeDeleteOptionsModal();
        selectedBatchIds.clear();
        updateSelectedCount();
        if (batchSelectMode) toggleBatchSelectMode();
        await refreshPointsAfterBatchMutation({
            batchId: activeBatchId,
            onMissing: () => {
                announcePointsAction('当前打开的批次已从当前站点移除，已自动关闭详情。', 'info');
            }
        });
        setPointsBatchListFeedback(feedback.message, feedback.tone, 'action', {
            detail: feedback.detail,
            stats: feedback.stats
        });

    } catch (err) {
        console.error('Delete failed:', err);
        announcePointsScopedAction(`删除失败: ${err.message}`, 'error', { batchList: true });
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
    copyPointsTextToClipboard(generatedCodes.join('\n'), {
        successMessage: `已复制 ${generatedCodes.length} 个兑换码`,
        emptyMessage: '当前没有可复制的兑换码'
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
    const normalizedBatchId = String(batchId || '').trim();
    if (!normalizedBatchId) return false;
    const requestId = ++pointsBatchCodesRequestId;
    let batch = allBatches.find((b) => String(b?.id || '') === normalizedBatchId);
    let initialPayload = null;
    if (String(pointsBatchCodesFeedbackState.batchId || '').trim() && String(pointsBatchCodesFeedbackState.batchId || '').trim() !== String(batchId || '').trim()) {
        clearPointsBatchCodesFeedback();
    }

    if (String(pointsBatchCodesUiState.batchId || '') !== normalizedBatchId) {
        resetPointsBatchCodesUiState(normalizedBatchId);
    } else {
        pointsBatchCodesUiState.batchId = normalizedBatchId;
    }

    if (pendingPointsBatchCodeFocus.batchId && pendingPointsBatchCodeFocus.batchId === normalizedBatchId) {
        pointsBatchCodesUiState.focusCode = pendingPointsBatchCodeFocus.code;
        if (pendingPointsBatchCodeFocus.code) {
            pointsBatchCodesUiState.search = pendingPointsBatchCodeFocus.code;
            pointsBatchCodesUiState.status = 'all';
        }
        clearPendingPointsBatchCodeFocus();
    }

    const headerTitle = batch?.name || '批次详情';
    const headerSubtitle = batch
        ? [
            formatPointsGenerateSiteLabel(batch.site || getPointsReadSite()),
            formatPointsGenerateChannelLabel(batch.channel),
            `创建于 ${formatPointsGenerateDateTime(batch.created_at)}`
        ].join(' · ')
        : `批次 ${normalizedBatchId.slice(0, 8) || normalizedBatchId} · 正在加载明细`;

    document.querySelector('.codes-modal-overlay')?.remove();
    const loadingHtml = `
        <div class="codes-modal-overlay" data-points-overlay-close="codes">
            <div class="codes-modal codes-modal--batch">
                <div class="codes-modal-header codes-modal-header--batch">
                    <div class="codes-modal-header__copy">
                        <span class="codes-modal-header__eyebrow">批次详情</span>
                        <h3>${escapePointsHtml(headerTitle)}</h3>
                        <p>${escapePointsHtml(headerSubtitle)}</p>
                    </div>
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
    window.currentViewBatchId = normalizedBatchId;

    try {
        if (!batch) {
            initialPayload = await fetchPointsBatchesPayload({
                site: getPointsReadSite(),
                batchId: normalizedBatchId
            });
            if (requestId !== pointsBatchCodesRequestId || String(window.currentViewBatchId || '').trim() !== normalizedBatchId) {
                return false;
            }
            batch = upsertPointsBatchRow(initialPayload?.batch || null) || null;
        }

        if (!batch) {
            throw new Error('未找到对应批次，可能已被删除或切换了站点');
        }

        const payload = initialPayload || await fetchPointsBatchesPayload({
            site: getPointsReadSite(),
            batchId: normalizedBatchId
        });
        if (requestId !== pointsBatchCodesRequestId || String(window.currentViewBatchId || '').trim() !== normalizedBatchId) {
            return false;
        }
        batch = upsertPointsBatchRow(payload?.batch || batch) || batch;
        const data = Array.isArray(payload?.codes) ? payload.codes : [];
        const modalBody = document.querySelector('.codes-modal-body');
        if (!modalBody) return false;
        const headerTitleEl = document.querySelector('.codes-modal-header__copy h3');
        const headerSubtitleEl = document.querySelector('.codes-modal-header__copy p');

        const pointsPerCode = Math.max(0, Number(batch.custom_points_amount) || Number(batch.points_packages?.points_amount) || 0);
        const packageLabel = batch.points_packages?.name || (Math.max(0, Number(batch.custom_points_amount) || 0) > 0 ? '自定义积分' : '未命名套餐');
        const riskBadges = buildPointsBatchRiskBadges(batch);
        const codeCounts = getPointsBatchCodeStatusCounts(data);
        const usagePercent = codeCounts.total > 0 ? Math.round((codeCounts.used / codeCounts.total) * 100) : 0;
        const refreshedInsights = getPointsBatchInsights(batch);
        const refreshedHeaderSubtitle = [
            formatPointsGenerateSiteLabel(batch.site || getPointsReadSite()),
            formatPointsGenerateChannelLabel(batch.channel),
            `创建于 ${formatPointsGenerateDateTime(batch.created_at)}`
        ].join(' · ');
        pointsBatchCodesUiState.codes = data;
        pointsBatchCodesUiState.visibleCodes = data;

        if (headerTitleEl) {
            headerTitleEl.textContent = batch.name || '未命名批次';
        }
        if (headerSubtitleEl) {
            headerSubtitleEl.textContent = refreshedHeaderSubtitle;
        }

        const actionsHtml = [
            buildPointsBatchCodesActionButton({
                action: 'open-batch-edit-from-codes',
                batchId: normalizedBatchId,
                iconClass: 'fas fa-pen-ruler',
                label: '编辑批次',
                tone: 'default'
            }),
            buildPointsBatchCodesActionButton({
                action: 'reissue-batch-from-codes',
                batchId: normalizedBatchId,
                iconClass: 'fas fa-wand-magic-sparkles',
                label: '续发同类批次',
                tone: 'accent'
            }),
            buildPointsBatchCodesActionButton({
                action: 'export-batch-codes-from-modal',
                batchId: normalizedBatchId,
                iconClass: 'fas fa-file-export',
                label: '导出 Excel',
                tone: 'default'
            }),
            buildPointsBatchCodesActionButton({
                action: 'invalidate-batch-from-codes',
                batchId: normalizedBatchId,
                iconClass: 'fas fa-ban',
                label: '作废未使用',
                tone: 'danger',
                disabled: codeCounts.pending <= 0
            })
        ].join('');

        const summaryCards = [
            buildPointsBatchCodesSummaryCard({
                iconClass: 'fas fa-ticket-alt',
                label: '兑换码总量',
                value: `${codeCounts.total} 个`,
                meta: pointsPerCode > 0 ? `${pointsPerCode} 分 / 码` : '面额未设置',
                tone: 'blue'
            }),
            buildPointsBatchCodesSummaryCard({
                iconClass: 'fas fa-hourglass-half',
                label: '待使用',
                value: `${codeCounts.pending} 个`,
                meta: '可继续被兑换',
                tone: 'amber'
            }),
            buildPointsBatchCodesSummaryCard({
                iconClass: 'fas fa-circle-check',
                label: '已使用',
                value: `${codeCounts.used} 个`,
                meta: `使用率 ${usagePercent}%`,
                tone: 'green'
            }),
            buildPointsBatchCodesSummaryCard({
                iconClass: 'fas fa-shield-exclamation',
                label: '风险 / 失效',
                value: `${codeCounts.risk} 个`,
                meta: `撤销 ${codeCounts.revoked} · 禁用 ${codeCounts.disabled}`,
                tone: 'rose'
            }),
            buildPointsBatchCodesSummaryCard({
                iconClass: 'fas fa-calendar-days',
                label: '批次有效期',
                value: formatPointsBatchExpiryLabel(batch, refreshedInsights),
                meta: batch.expires_at ? formatPointsGenerateDateTime(batch.expires_at) : '未设置单独过期时间',
                tone: refreshedInsights.isExpiringSoon ? 'amber' : 'slate'
            })
        ].join('');

        modalBody.classList.remove('loading-state');
        modalBody.innerHTML = `
            <div class="points-batch-codes-workbench">
                <section class="points-batch-codes-hero">
                    <div class="points-batch-codes-hero__copy">
                        <span class="points-batch-codes-hero__eyebrow">当前批次</span>
                        <strong class="points-batch-codes-hero__title">${escapePointsHtml(batch.name || '未命名批次')}</strong>
                        <div class="points-batch-codes-hero__meta">
                            <span>${escapePointsHtml(packageLabel)}</span>
                            <span>${escapePointsHtml(formatPointsGenerateChannelLabel(batch.channel))}</span>
                            <span>${escapePointsHtml(formatPointsGenerateSiteLabel(batch.site || getPointsReadSite()))}</span>
                        </div>
                    </div>
                    <div class="points-batch-codes-hero__side">
                        <div class="points-batch-codes-risk-row">${riskBadges}</div>
                        <div class="points-site-context points-site-context--batch-edit">
                            ${buildPointsSiteContextMarkup('batch')}
                        </div>
                    </div>
                </section>
                <div class="points-batch-codes-summary-grid">${summaryCards}</div>
                <section class="points-batch-codes-panel">
                    <div class="points-batch-codes-panel__header">
                        <div class="points-batch-codes-panel__copy">
                            <span class="points-batch-codes-panel__eyebrow">批次操作</span>
                            <h4>就地处理这个批次</h4>
                            <p>继续补发、编辑元信息、导出明细，或直接作废当前还没使用的兑换码。</p>
                        </div>
                        <div class="points-batch-codes-actions">${actionsHtml}</div>
                    </div>
                </section>
                <div class="points-inline-feedback-shell" id="pointsBatchCodesInlineFeedback">${buildPointsInlineFeedbackMarkup(pointsBatchCodesFeedbackState.message, pointsBatchCodesFeedbackState.tone)}</div>
                ${buildPointsBatchCodesTableSection(data)}
            </div>
        `;

        modalBody.scrollTop = 0;
        bindPointsBatchCodesTableControls();
        enableHorizontalScroll(modalBody.querySelector('.points-batch-codes-table-shell') || modalBody);
        if (pointsBatchCodesUiState.focusCode) {
            focusPointsBatchCodeInModal(pointsBatchCodesUiState.focusCode);
        }
        return true;
    } catch (err) {
        if (requestId !== pointsBatchCodesRequestId || String(window.currentViewBatchId || '').trim() !== normalizedBatchId) {
            return false;
        }
        const modalBody = document.querySelector('.codes-modal-body');
        if (modalBody) {
            modalBody.classList.remove('loading-state');
            modalBody.innerHTML = buildPointsBatchCodesLoadFailureMarkup(
                getPointsBatchLoadFailureMessage(err),
                '可以返回批次列表重新打开，或确认当前站点筛选是否正确。'
            );
        }
        return false;
    }
}

async function invalidateSingleBatch(batchId) {
    openPointsBatchInvalidateModal([batchId]);
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
        resetPointsBatchCodesUiState();
        clearPendingPointsBatchCodeFocus();
        clearPointsBatchCodesFeedback();
    }
}

function getPointsBatchInvalidateModalPayload(batchIds = []) {
    const normalizedIds = Array.from(new Set((Array.isArray(batchIds) ? batchIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)));

    const rows = normalizedIds
        .map((id) => allBatches.find((row) => String(row?.id || '') === id))
        .filter(Boolean);

    const pendingCount = rows.reduce((sum, row) => {
        return sum + Math.max(0, Number(row?.total_count) || 0) - Math.max(0, Number(row?.used_count) || 0);
    }, 0);

    return {
        batchIds: normalizedIds,
        rows,
        pendingCount,
        batchLabel: rows.map((row) => row.name || '未命名批次').join('、')
    };
}

function syncPointsBatchInvalidateModalState() {
    const contextRoot = document.getElementById('pointsBatchInvalidateWriteContext');
    const submitBtn = document.getElementById('pointsBatchInvalidateSubmitBtn');
    const context = getPointsWriteContextState();

    if (contextRoot) {
        contextRoot.innerHTML = buildPointsSiteContextMarkup('batch');
    }

    if (submitBtn) {
        submitBtn.disabled = !context.canWrite || pointsBatchInvalidateModalState.submitting;
    }
}

function closePointsBatchInvalidateModal(event) {
    if (!event || event.target.classList.contains('edit-modal-overlay')) {
        const overlay = document.querySelector('.points-batch-invalidate-modal-overlay');
        if (!overlay) {
            return;
        }

        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            overlay.remove();
        }, 260);
        pointsBatchInvalidateModalState = {
            batchIds: [],
            submitting: false
        };
    }
}

function openPointsBatchInvalidateModal(batchIds = []) {
    const payload = getPointsBatchInvalidateModalPayload(batchIds);
    if (!payload.rows.length) {
        announcePointsAction('未找到可操作的批次', 'error');
        return;
    }

    if (payload.pendingCount <= 0) {
        announcePointsAction('这些批次当前没有可作废的未使用兑换码', 'error');
        return;
    }

    document.querySelector('.points-batch-invalidate-modal-overlay')?.remove();
    pointsBatchInvalidateModalState = {
        batchIds: payload.batchIds,
        submitting: false
    };

    const modalHtml = `
        <div class="edit-modal-overlay points-batch-invalidate-modal-overlay" data-points-overlay-close="batch-invalidate">
            <div class="edit-modal edit-modal--code-action edit-modal--batch-invalidate">
                <div class="edit-modal-header">
                    <div class="edit-modal-header__copy">
                        <span class="edit-modal-header__eyebrow">批次工具</span>
                        <h3>作废未使用兑换码</h3>
                        <p>系统只会处理当前仍处于待使用状态的兑换码，已经使用或已撤销的记录不会被改动。</p>
                    </div>
                    <button class="edit-modal-close" type="button" data-points-action="close-batch-invalidate-modal">✕</button>
                </div>
                <form class="edit-modal-form points-code-action-form" data-points-submit="submit-batch-invalidate">
                    <section class="points-code-action-summary points-code-action-summary--danger">
                        <div class="points-code-action-summary__icon"><i class="fas fa-ban"></i></div>
                        <div class="points-code-action-summary__copy">
                            <span class="points-code-action-summary__eyebrow">即将处理</span>
                            <strong class="points-code-action-summary__code">${escapePointsHtml(payload.rows.length === 1 ? (payload.rows[0].name || '未命名批次') : `${payload.rows.length} 个批次`)}</strong>
                            <p>共会作废 <strong>${escapePointsHtml(payload.pendingCount)} 个</strong> 待使用兑换码。</p>
                        </div>
                    </section>
                    <div class="points-site-context points-site-context--code-action" id="pointsBatchInvalidateWriteContext">
                        ${buildPointsSiteContextMarkup('batch')}
                    </div>
                    <section class="points-batch-invalidate-list">
                        <div class="points-batch-invalidate-list__title">本次涉及批次</div>
                        <div class="points-batch-invalidate-list__items">
                            ${payload.rows.map((row) => {
                                const pending = Math.max(0, Number(row.total_count) || 0) - Math.max(0, Number(row.used_count) || 0);
                                return `
                                    <article class="points-batch-invalidate-item">
                                        <strong>${escapePointsHtml(row.name || '未命名批次')}</strong>
                                        <span>${escapePointsHtml(formatPointsGenerateChannelLabel(row.channel))} · ${escapePointsHtml(formatPointsGenerateSiteLabel(row.site || getPointsReadSite()))}</span>
                                        <em>待作废 ${escapePointsHtml(pending)} 个</em>
                                    </article>
                                `;
                            }).join('')}
                        </div>
                    </section>
                    <div class="points-code-action-actions">
                        <button class="points-code-action-cancel" type="button" data-points-action="close-batch-invalidate-modal">取消</button>
                        <button class="points-code-action-submit points-code-action-submit--danger" type="submit" id="pointsBatchInvalidateSubmitBtn">
                            <i class="fas fa-ban"></i>
                            <span>确认作废未使用</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const overlay = document.querySelector('.points-batch-invalidate-modal-overlay');
    if (overlay) {
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });
    }

    syncPointsBatchInvalidateModalState();
}

async function submitPointsBatchInvalidate(event) {
    event.preventDefault();

    const batchIds = Array.from(pointsBatchInvalidateModalState.batchIds || []);
    if (!batchIds.length) {
        return;
    }

    const writableSite = requireWritablePointsSite({ action: 'points-batch-invalidate' });
    if (!writableSite) {
        syncPointsBatchInvalidateModalState();
        return;
    }

    pointsBatchInvalidateModalState.submitting = true;
    syncPointsBatchInvalidateModalState();

    try {
        const activeBatchId = String(window.currentViewBatchId || '').trim();
        const payload = await mutatePointsManage({
            action: 'invalidate_batches',
            site: writableSite,
            payload: {
                batch_ids: batchIds
            }
        });

        closePointsBatchInvalidateModal();
        const menu = document.getElementById('pointsBatchActionsMenu');
        if (menu) {
            menu.classList.remove('show');
        }

        await refreshPointsAfterBatchMutation({ batchId: activeBatchId });
        updateSelectedCount();

        const inBatchListView = !window.currentViewBatchId && getActivePointsViewName() === 'batches';
        if (inBatchListView) {
            const feedback = buildPointsBatchActionFeedback('invalidate', payload, {
                requestedBatchCount: batchIds.length
            });
            setPointsBatchListFeedback(feedback.message, feedback.tone, 'action', {
                detail: feedback.detail,
                stats: feedback.stats
            });
        }

        if (window.currentViewBatchId) {
            announcePointsScopedAction(payload?.message || '已作废未使用兑换码', payload?.disabled_code_count > 0 ? 'success' : 'info', {
                batch: true,
                batchId: window.currentViewBatchId
            });
        }
    } catch (error) {
        pointsBatchInvalidateModalState.submitting = false;
        syncPointsBatchInvalidateModalState();
        announcePointsAction(error.message || '作废失败，请稍后再试。', 'error');
    }
}

function buildPointsCodeActionModalConfig(mode = '', code = '', currentExpiry = '') {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    const expiryLabel = currentExpiry
        ? new Date(currentExpiry).toLocaleDateString('zh-CN')
        : '继承批次有效期';

    const configs = {
        expiry: {
            eyebrow: '兑换码工具',
            title: '设置有效期',
            description: '为这条兑换码单独设置过期时间；留空后会恢复继承批次有效期。',
            icon: 'fas fa-calendar-alt',
            confirmLabel: '保存有效期',
            confirmTone: 'default',
            submitMode: 'expiry',
            helper: `当前有效期：${expiryLabel}`,
            fieldMarkup: `
                <div class="edit-field">
                    <label for="pointsCodeActionExpiry">新的有效期</label>
                    <input
                        id="pointsCodeActionExpiry"
                        class="flatpickr-input"
                        type="text"
                        value="${escapePointsHtml(currentExpiry ? new Date(currentExpiry).toISOString().split('T')[0] : '')}"
                        placeholder="留空则恢复继承批次"
                    >
                </div>
            `
        },
        disable: {
            eyebrow: '兑换码工具',
            title: '禁用兑换码',
            description: '禁用后这条码将无法继续使用，但不会影响已经存在的兑换记录。',
            icon: 'fas fa-ban',
            confirmLabel: '确认禁用',
            confirmTone: 'danger',
            submitMode: 'disable',
            helper: '适用于待使用兑换码的临时封禁或异常止损。',
            fieldMarkup: ''
        },
        revoke: {
            eyebrow: '兑换码工具',
            title: '撤销兑换',
            description: '撤销会回滚这条兑换码对应的使用结果，并按规则扣回已发积分。',
            icon: 'fas fa-rotate-left',
            confirmLabel: '确认撤销',
            confirmTone: 'danger',
            submitMode: 'revoke',
            helper: '建议补充撤销原因，方便后续审计排查。',
            fieldMarkup: `
                <div class="edit-field">
                    <label for="pointsCodeActionReason">撤销原因</label>
                    <textarea id="pointsCodeActionReason" rows="4" placeholder="例如：异常兑换、人工核销错误、售后回滚...">管理员撤销</textarea>
                </div>
            `
        },
        enable: {
            eyebrow: '兑换码工具',
            title: '重新启用兑换码',
            description: '重新启用后，这条码会恢复到待使用状态，可以再次被兑换。',
            icon: 'fas fa-check',
            confirmLabel: '确认启用',
            confirmTone: 'success',
            submitMode: 'enable',
            helper: '仅适用于当前处于禁用状态的兑换码。',
            fieldMarkup: ''
        }
    };

    return configs[normalizedMode] || null;
}

function renderPointsCodeActionModalError(message = '') {
    const errorEl = document.getElementById('pointsCodeActionError');
    if (!errorEl) {
        return;
    }

    const normalizedMessage = String(message || '').trim();
    errorEl.textContent = normalizedMessage;
    setAdminPointsVisibility(errorEl, Boolean(normalizedMessage));
}

function syncPointsCodeActionModalState() {
    const contextRoot = document.getElementById('pointsCodeActionWriteContext');
    const submitBtn = document.getElementById('pointsCodeActionSubmitBtn');
    const context = getPointsWriteContextState();

    if (contextRoot) {
        contextRoot.innerHTML = buildPointsSiteContextMarkup('batch');
    }

    if (submitBtn) {
        submitBtn.disabled = !context.canWrite || pointsCodeActionModalState.submitting;
    }
}

function closePointsCodeActionModal(event) {
    if (!event || event.target.classList.contains('edit-modal-overlay')) {
        const overlay = document.querySelector('.points-code-action-modal-overlay');
        if (!overlay) {
            return;
        }

        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            overlay.remove();
        }, 260);
        pointsCodeActionModalState = {
            mode: '',
            code: '',
            currentExpiry: '',
            source: '',
            submitting: false
        };
    }
}

function openPointsCodeActionModal({ mode = '', code = '', currentExpiry = '', source = '' } = {}) {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) {
        return;
    }

    const config = buildPointsCodeActionModalConfig(mode, normalizedCode, currentExpiry);
    if (!config) {
        return;
    }

    document.querySelector('.points-code-action-modal-overlay')?.remove();
    pointsCodeActionModalState = {
        mode: config.submitMode,
        code: normalizedCode,
        currentExpiry: String(currentExpiry || ''),
        source: String(source || '').trim(),
        submitting: false
    };

    const modalHtml = `
        <div class="edit-modal-overlay points-code-action-modal-overlay" data-points-overlay-close="code-action">
            <div class="edit-modal edit-modal--code-action">
                <div class="edit-modal-header">
                    <div class="edit-modal-header__copy">
                        <span class="edit-modal-header__eyebrow">${escapePointsHtml(config.eyebrow)}</span>
                        <h3>${escapePointsHtml(config.title)}</h3>
                        <p>${escapePointsHtml(config.description)}</p>
                    </div>
                    <button class="edit-modal-close" type="button" data-points-action="close-code-action-modal">✕</button>
                </div>
                <form class="edit-modal-form points-code-action-form" data-points-submit="submit-code-action">
                    <section class="points-code-action-summary">
                        <div class="points-code-action-summary__icon"><i class="${escapePointsHtml(config.icon)}"></i></div>
                        <div class="points-code-action-summary__copy">
                            <span class="points-code-action-summary__eyebrow">当前兑换码</span>
                            <strong class="points-code-action-summary__code">${escapePointsHtml(normalizedCode)}</strong>
                            <p>${escapePointsHtml(config.helper)}</p>
                        </div>
                    </section>
                    <div class="points-site-context points-site-context--code-action" id="pointsCodeActionWriteContext">
                        ${buildPointsSiteContextMarkup('batch')}
                    </div>
                    ${config.fieldMarkup}
                    <div class="points-code-action-error ${ADMIN_POINTS_HIDDEN_CLASS}" id="pointsCodeActionError"></div>
                    <div class="points-code-action-actions">
                        <button class="points-code-action-cancel" type="button" data-points-action="close-code-action-modal">取消</button>
                        <button class="points-code-action-submit points-code-action-submit--${escapePointsHtml(config.confirmTone)}" type="submit" id="pointsCodeActionSubmitBtn">
                            <i class="${escapePointsHtml(config.icon)}"></i>
                            <span>${escapePointsHtml(config.confirmLabel)}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const overlay = document.querySelector('.points-code-action-modal-overlay');
    if (overlay) {
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });
    }

    if (config.submitMode === 'expiry' && typeof flatpickr !== 'undefined') {
        flatpickr('#pointsCodeActionExpiry', {
            locale: 'zh',
            dateFormat: 'Y-m-d',
            allowInput: true,
            minDate: 'today'
        });
    }

    syncPointsCodeActionModalState();
}

async function refreshPointsAfterCodeMutation(code = '') {
    invalidatePointsCatalogSnapshot();
    await loadBatches();

    if (window.currentViewBatchId) {
        pointsBatchCodesUiState.focusCode = String(code || '').trim();
        await viewBatchCodes(window.currentViewBatchId);
    }

    await refreshPointsLookupResultIfNeeded();
}

async function refreshPointsAfterBatchMutation({ batchId = '', onMissing = null } = {}) {
    const normalizedBatchId = String(batchId || '').trim();

    invalidatePointsCatalogSnapshot();
    await loadBatches();
    await refreshPointsLookupResultIfNeeded();

    const activeBatchId = normalizedBatchId || String(window.currentViewBatchId || '').trim();
    if (activeBatchId && String(window.currentViewBatchId || '').trim() === activeBatchId) {
        await syncCurrentPointsBatchDetailAfterListReload({ onMissing });
    }
}

async function submitPointsCodeAction(event) {
    event.preventDefault();

    const form = event.target instanceof HTMLFormElement ? event.target : event.target?.closest('form');
    const mode = String(pointsCodeActionModalState.mode || '').trim().toLowerCase();
    const code = String(pointsCodeActionModalState.code || '').trim();
    if (!form || !mode || !code) {
        return;
    }

    const writableSite = requireWritablePointsCodeActionSite(mode);
    if (!writableSite) {
        syncPointsCodeActionModalState();
        return;
    }

    let action = '';
    let payload = {};
    let successMessage = '';

    if (mode === 'expiry') {
        const expiryInput = document.getElementById('pointsCodeActionExpiry');
        const rawValue = String(expiryInput?.value || '').trim();
        let expiresAt = null;

        if (rawValue) {
            const parsed = new Date(rawValue);
            if (Number.isNaN(parsed.getTime())) {
                renderPointsCodeActionModalError('请输入有效的日期，格式为 YYYY-MM-DD。');
                return;
            }

            parsed.setHours(23, 59, 59, 999);
            expiresAt = parsed.toISOString();
        }

        action = 'set_code_expiry';
        payload = {
            code,
            expires_at: expiresAt
        };
        successMessage = '有效期已更新';
    } else if (mode === 'disable') {
        action = 'set_code_status';
        payload = {
            code,
            status: 'disabled'
        };
        successMessage = '已禁用该兑换码';
    } else if (mode === 'enable') {
        action = 'set_code_status';
        payload = {
            code,
            status: 'pending'
        };
        successMessage = '已重新启用兑换码';
    } else if (mode === 'revoke') {
        const reasonInput = document.getElementById('pointsCodeActionReason');
        action = 'revoke_code';
        payload = {
            code,
            reason: String(reasonInput?.value || '').trim() || '管理员撤销'
        };
        successMessage = '撤销成功';
    } else {
        return;
    }

    renderPointsCodeActionModalError('');
    pointsCodeActionModalState.submitting = true;
    syncPointsCodeActionModalState();

    try {
        const responsePayload = await mutatePointsManage({
            action,
            site: writableSite,
            payload
        });

        const feedbackSource = String(pointsCodeActionModalState.source || '').trim();
        closePointsCodeActionModal();
        await refreshPointsAfterCodeMutation(code);

        const deducted = mode === 'revoke' ? Math.max(0, Number(responsePayload?.points_deducted) || 0) : 0;
        const feedbackMessage = responsePayload?.message || `${successMessage}${deducted > 0 ? `，已扣回 ${deducted} 积分` : ''}`;
        announcePointsScopedAction(feedbackMessage, 'success', {
            lookup: feedbackSource === 'lookup',
            batch: feedbackSource === 'batch-codes',
            batchId: window.currentViewBatchId
        });
    } catch (error) {
        pointsCodeActionModalState.submitting = false;
        syncPointsCodeActionModalState();
        renderPointsCodeActionModalError(error.message || '操作失败，请稍后再试。');
    }
}

// ========================================
// SET CODE EXPIRY
// ========================================
async function setCodeExpiry(code, currentExpiry, source = '') {
    if (!String(code || '').trim()) {
        return;
    }
    openPointsCodeActionModal({ mode: 'expiry', code, currentExpiry, source });
}

// ========================================
// REVOKE CODE
// ========================================
async function revokeCode(code, source = '') {
    if (!String(code || '').trim()) {
        return;
    }
    openPointsCodeActionModal({ mode: 'revoke', code, source });
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
        announcePointsScopedAction('暂无批次可导出', 'error', { batchList: true });
        return;
    }

    try {
        const channelLabels = {
            xianyu: '闲鱼',
            taobao: '淘宝',
            manual: '手动',
            promotion: '促销',
            test: '测试'
        };

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

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '批次列表');

        ws['!cols'] = [
            { wch: 20 },
            { wch: 15 },
            { wch: 8 },
            { wch: 8 },
            { wch: 8 },
            { wch: 8 },
            { wch: 8 },
            { wch: 18 },
            { wch: 18 },
            { wch: 20 }
        ];

        const now = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `批次列表_${now}.xlsx`);
        const feedback = buildPointsBatchActionFeedback('export-all', {}, {
            totalCount: allBatches.length,
            filteredCount: filteredBatches.length
        });
        setPointsBatchListFeedback(feedback.message, feedback.tone, 'action', {
            detail: feedback.detail,
            stats: feedback.stats
        });
    } catch (err) {
        announcePointsScopedAction(`导出失败: ${err.message}`, 'error', { batchList: true });
    }
}

// Export selected batches (with all codes)
async function exportSelectedBatches() {
    closeAllBatchDropdowns();

    if (selectedBatchIds.size === 0) {
        announcePointsScopedAction('请先选择要导出的批次', 'error', { batchList: true });
        return;
    }

    try {
        const wb = XLSX.utils.book_new();
        const usedNames = new Set();
        let index = 1;
        let exportedCount = 0;

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
            exportedCount += 1;
        }

        const now = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `选中批次_${selectedBatchIds.size}个_${now}.xlsx`);
        const feedback = buildPointsBatchActionFeedback('export-selected', {}, {
            requestedBatchCount: selectedBatchIds.size,
            exportedCount,
            missingCount: Math.max(0, selectedBatchIds.size - exportedCount)
        });
        setPointsBatchListFeedback(feedback.message, feedback.tone, 'action', {
            detail: feedback.detail,
            stats: feedback.stats
        });

    } catch (err) {
        announcePointsScopedAction(`导出失败: ${err.message}`, 'error', { batchList: true });
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
        announcePointsScopedAction(`已导出批次「${batch.name || '未命名批次'}」`, 'success', {
            batch: Boolean(window.currentViewBatchId && String(window.currentViewBatchId) === String(batchId || '')),
            batchId
        });

    } catch (err) {
        announcePointsScopedAction(`导出失败: ${err.message}`, 'error', {
            batch: Boolean(window.currentViewBatchId && String(window.currentViewBatchId) === String(batchId || '')),
            batchId
        });
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

function getPointsBatchCodeStatusCounts(codes = []) {
    const counts = {
        total: 0,
        pending: 0,
        used: 0,
        revoked: 0,
        disabled: 0,
        locked: 0,
        expired: 0
    };

    (Array.isArray(codes) ? codes : []).forEach((row) => {
        const status = String(row?.status || '').trim().toLowerCase();
        counts.total += 1;
        if (Object.prototype.hasOwnProperty.call(counts, status)) {
            counts[status] += 1;
        }
    });

    counts.risk = counts.revoked + counts.disabled + counts.locked + counts.expired;
    return counts;
}

function buildPointsBatchCodesSummaryCard({
    iconClass = 'fas fa-ticket-alt',
    label = '',
    value = '',
    meta = '',
    tone = 'blue'
} = {}) {
    return `
        <article class="points-batch-codes-summary-card points-batch-codes-summary-card--${escapePointsHtml(tone)}">
            <span class="points-batch-codes-summary-card__icon"><i class="${escapePointsHtml(iconClass)}"></i></span>
            <div class="points-batch-codes-summary-card__body">
                <span class="points-batch-codes-summary-card__label">${escapePointsHtml(label)}</span>
                <strong class="points-batch-codes-summary-card__value">${escapePointsHtml(value)}</strong>
                ${meta ? `<span class="points-batch-codes-summary-card__meta">${escapePointsHtml(meta)}</span>` : ''}
            </div>
        </article>
    `;
}

function buildPointsBatchCodesActionButton({
    action = '',
    batchId = '',
    iconClass = 'fas fa-arrow-right',
    label = '',
    tone = 'default',
    disabled = false
} = {}) {
    return `
        <button class="points-batch-codes-action-btn points-batch-codes-action-btn--${escapePointsHtml(tone)}" type="button" data-points-action="${escapePointsHtml(action)}" data-batch-id="${encodeURIComponent(batchId)}" ${disabled ? 'disabled' : ''}>
            <i class="${escapePointsHtml(iconClass)}"></i>
            <span>${escapePointsHtml(label)}</span>
        </button>
    `;
}

// ========================================
// BATCH EDITING
// ========================================

function syncPointsBatchEditModalState() {
    const writeContextRoot = document.getElementById('pointsBatchEditWriteContext');
    const saveBtn = document.getElementById('batchEditSaveBtn');
    const saveLabel = saveBtn?.querySelector('.edit-modal-save__label');
    const context = getPointsWriteContextState();
    const isLoading = saveBtn?.dataset.loading === '1';

    if (writeContextRoot) {
        writeContextRoot.innerHTML = buildPointsSiteContextMarkup('batch');
    }

    if (saveBtn) {
        saveBtn.disabled = !context.canWrite || isLoading;
    }

    if (saveLabel && !isLoading) {
        saveLabel.textContent = context.canWrite ? '保存批次修改' : '先选择写入站点';
    }
}

// Open batch edit modal
function openBatchEditModal(batchId, { returnToCodes = false } = {}) {
    const normalizedBatchId = String(batchId || '').trim();
    const batch = allBatches.find((b) => String(b?.id || '').trim() === normalizedBatchId);
    if (!batch) return;

    pointsBatchEditContext = {
        batchId: normalizedBatchId,
        returnToCodes: Boolean(returnToCodes)
    };

    const context = getPointsWriteContextState();
    const insights = getPointsBatchInsights(batch);
    const packageLabel = batch.points_packages?.name || (insights.isCustom ? '自定义积分' : '未命名套餐');
    const pointsPerCode = Math.max(0, Number(batch.custom_points_amount) || Number(batch.points_packages?.points_amount) || 0);
    const usagePercent = insights.totalCount > 0 ? Math.round(insights.usageRate * 100) : 0;
    const expiryLabel = formatPointsBatchExpiryLabel(batch, insights);
    const riskBadges = buildPointsBatchRiskBadges(batch);
    const headerSubtitle = [
        formatPointsGenerateSiteLabel(batch.site || getPointsReadSite()),
        formatPointsGenerateChannelLabel(batch.channel),
        `创建于 ${formatPointsGenerateDateTime(batch.created_at)}`
    ].join(' · ');

    // Remove existing modal if any
    document.querySelector('.edit-modal-overlay')?.remove();

    const modalHtml = `
        <div class="edit-modal-overlay" data-points-overlay-close="batch-edit">
            <div class="edit-modal edit-modal--batch">
                <div class="edit-modal-header">
                    <div class="edit-modal-header__copy">
                        <span class="edit-modal-header__eyebrow">批次工作台</span>
                        <h3>编辑批次</h3>
                        <p>修改名称、备注和有效期，不会影响已经发放给用户的积分流水。</p>
                    </div>
                    <button class="edit-modal-close" type="button" data-points-action="close-batch-edit">✕</button>
                </div>
                <form id="batchEditForm" class="edit-modal-form edit-modal-form--batch" data-points-submit="save-batch-edit" data-batch-id="${encodeURIComponent(normalizedBatchId)}">
                    <div class="points-batch-edit-layout">
                        <aside class="points-batch-edit-aside">
                            <section class="points-batch-edit-hero">
                                <div class="points-batch-edit-hero__copy">
                                    <span class="points-batch-edit-hero__eyebrow">当前批次</span>
                                    <strong class="points-batch-edit-hero__title">${escapePointsHtml(batch.name || '未命名批次')}</strong>
                                    <span class="points-batch-edit-hero__subtitle">${escapePointsHtml(headerSubtitle)}</span>
                                </div>
                                <span class="points-batch-edit-hero__id">ID ${escapePointsHtml(String(batch.id || '').slice(0, 8) || '-')}</span>
                            </section>
                            <div class="points-batch-edit-risk-row">${riskBadges}</div>
                            <div class="points-batch-edit-overview">
                                ${buildPointsBatchEditOverviewCard({
                                    iconClass: 'fas fa-ticket-alt',
                                    label: '发码规模',
                                    value: `${insights.totalCount} 个`,
                                    meta: `已用 ${insights.usedCount} · ${usagePercent}%`,
                                    tone: 'blue'
                                })}
                                ${buildPointsBatchEditOverviewCard({
                                    iconClass: 'fas fa-gift',
                                    label: '套餐 / 面额',
                                    value: packageLabel,
                                    meta: pointsPerCode > 0 ? `${pointsPerCode} 分 / 码` : '面额未设置',
                                    tone: 'violet'
                                })}
                                ${buildPointsBatchEditOverviewCard({
                                    iconClass: 'fas fa-store',
                                    label: '渠道 / 站点',
                                    value: formatPointsGenerateChannelLabel(batch.channel),
                                    meta: formatPointsGenerateSiteLabel(batch.site || getPointsReadSite()),
                                    tone: 'slate'
                                })}
                                ${buildPointsBatchEditOverviewCard({
                                    iconClass: 'fas fa-hourglass-half',
                                    label: '有效期状态',
                                    value: expiryLabel,
                                    meta: batch.expires_at ? formatPointsGenerateDateTime(batch.expires_at) : '未设置单独过期时间',
                                    tone: insights.isExpiringSoon ? 'amber' : 'green'
                                })}
                            </div>
                            <div class="points-batch-edit-actions">
                                <button class="points-batch-edit-action-btn" type="button" data-points-action="open-batch-codes-from-edit" data-batch-id="${encodeURIComponent(normalizedBatchId)}">
                                    <i class="fas fa-list-ul"></i>
                                    <span>查看兑换码</span>
                                </button>
                                <button class="points-batch-edit-action-btn points-batch-edit-action-btn--accent" type="button" data-points-action="reissue-batch-from-edit" data-batch-id="${encodeURIComponent(normalizedBatchId)}">
                                    <i class="fas fa-wand-magic-sparkles"></i>
                                    <span>续发同类批次</span>
                                </button>
                            </div>
                            <div class="points-site-context points-site-context--batch-edit" id="pointsBatchEditWriteContext">
                                ${buildPointsSiteContextMarkup('batch')}
                            </div>
                        </aside>
                        <section class="points-batch-edit-editor">
                            <div class="edit-field">
                                <label>批次名称</label>
                                <input type="text" id="editBatchName" value="${escapePointsHtml(batch.name || '')}" required maxlength="100">
                            </div>
                            <div class="edit-field">
                                <label>备注</label>
                                <textarea id="editBatchNotes" rows="4" placeholder="补充渠道来源、活动说明或交接备注...">${escapePointsHtml(batch.notes || '')}</textarea>
                            </div>
                            <div class="edit-field">
                                <label>过期时间</label>
                                <input type="text" id="editBatchExpires" class="flatpickr-input" 
                                    value="${batch.expires_at ? new Date(batch.expires_at).toISOString().slice(0, 16).replace('T', ' ') : ''}" 
                                    placeholder="留空表示继承长期有效">
                            </div>
                            <div class="points-batch-edit-form-note">
                                这里只会更新批次元信息；站点、渠道、套餐与实际发码数量保持原样，若要继续补发可直接使用左侧的“续发同类批次”。
                            </div>
                            <button type="submit" class="edit-modal-save" id="batchEditSaveBtn" ${context.canWrite ? '' : 'disabled'}>
                                <i class="fas fa-save"></i>
                                <span class="edit-modal-save__label">${context.canWrite ? '保存批次修改' : '先选择写入站点'}</span>
                            </button>
                        </section>
                    </div>
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

    syncPointsBatchEditModalState();
}

function closeBatchEditModal(event) {
    if (!event || event.target.classList.contains('edit-modal-overlay')) {
        const overlay = document.querySelector('.edit-modal-overlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            overlay.remove();
        }, 260);
        pointsBatchEditContext = {
            batchId: '',
            returnToCodes: false
        };
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
    const normalizedBatchId = String(batchId || '').trim();
    const shouldReturnToCodes = pointsBatchEditContext.returnToCodes
        && String(pointsBatchEditContext.batchId || '').trim() === normalizedBatchId;

    if (!name) {
        announcePointsAction('批次名称不能为空', 'error');
        return;
    }

    const btn = event.target.querySelector('button[type="submit"]');
    btn.dataset.loading = '1';
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span class="edit-modal-save__label">保存中...</span>';

    try {
        const payload = await mutatePointsManage({
            action: 'update_batch',
            site: writableSite,
            payload: {
                batch_id: normalizedBatchId,
                name: name,
                notes: notes || null,
                expires_at: expiresAt
            }
        });

        announcePointsAction(payload?.message || '保存成功', 'success');
        if (window.currentViewBatchId && String(window.currentViewBatchId) === normalizedBatchId) {
            setPointsBatchCodesFeedback(payload?.message || '保存成功', 'success', window.currentViewBatchId);
        }
        closeBatchEditModal();
        await refreshPointsAfterBatchMutation({ batchId: normalizedBatchId });
        if (shouldReturnToCodes) {
            await viewBatchCodes(normalizedBatchId);
            setPointsBatchCodesFeedback(payload?.message || '保存成功', 'success', normalizedBatchId);
        }

    } catch (err) {
        announcePointsAction(`保存失败: ${err.message}`, 'error');
        btn.dataset.loading = '0';
        btn.innerHTML = '<i class="fas fa-save"></i><span class="edit-modal-save__label">保存批次修改</span>';
        syncPointsBatchEditModalState();
    }
}

// ========================================
// CODE STATUS MANAGEMENT
// ========================================

// Disable a single code (mark as disabled/invalid)
async function disableCode(code, source = '') {
    if (!String(code || '').trim()) {
        return;
    }
    openPointsCodeActionModal({ mode: 'disable', code, source });
}

// Enable a previously disabled code
async function enableCode(code, source = '') {
    if (!String(code || '').trim()) {
        return;
    }
    openPointsCodeActionModal({ mode: 'enable', code, source });
}

// Batch invalidate all unused codes in selected batches
async function batchInvalidateCodes() {
    if (selectedBatchIds.size === 0) {
        announcePointsScopedAction('请先选择要操作的批次', 'error', { batchList: true });
        return;
    }

    openPointsBatchInvalidateModal(Array.from(selectedBatchIds));
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
function formatPointsLookupDateTime(value = '') {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return '未发生';
    }

    const date = new Date(normalizedValue);
    if (Number.isNaN(date.getTime())) {
        return normalizedValue;
    }

    return date.toLocaleString('zh-CN');
}

function getPointsLookupStatusMeta(status = '') {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const statusMap = {
        pending: { label: '待使用', tone: 'pending', icon: 'fas fa-hourglass-half' },
        locked: { label: '已锁定', tone: 'locked', icon: 'fas fa-lock' },
        used: { label: '已使用', tone: 'used', icon: 'fas fa-circle-check' },
        revoked: { label: '已撤销', tone: 'revoked', icon: 'fas fa-ban' },
        disabled: { label: '已禁用', tone: 'disabled', icon: 'fas fa-octagon-xmark' },
        expired: { label: '已过期', tone: 'expired', icon: 'fas fa-clock-rotate-left' }
    };

    return statusMap[normalizedStatus] || {
        label: normalizedStatus || '未知状态',
        tone: 'neutral',
        icon: 'fas fa-circle-info'
    };
}

function buildPointsLookupDetailRow(label, valueHtml) {
    return `
        <div class="lookup-detail">
            <span class="label">${escapePointsHtml(label)}</span>
            <span class="value">${valueHtml}</span>
        </div>
    `;
}

function buildPointsLookupSummaryCard(label, value, tone = 'default') {
    return `
        <article class="lookup-summary-card lookup-summary-card--${escapePointsHtml(tone)}">
            <span class="lookup-summary-card__label">${escapePointsHtml(label)}</span>
            <strong class="lookup-summary-card__value">${escapePointsHtml(value)}</strong>
        </article>
    `;
}

function buildPointsLookupFieldCard(label, valueHtml, tone = 'default', options = {}) {
    const classNames = [
        'lookup-field-card',
        `lookup-field-card--${escapePointsHtml(tone)}`
    ];

    if (options?.wide) {
        classNames.push('lookup-field-card--wide');
    }

    return `
        <article class="${classNames.join(' ')}">
            <span class="lookup-field-card__label">${escapePointsHtml(label)}</span>
            <div class="lookup-field-card__value">${valueHtml}</div>
        </article>
    `;
}

function buildPointsLookupTimelineItem({ title = '', meta = '', detail = '', tone = 'neutral', icon = 'fas fa-circle-info' } = {}) {
    return `
        <li class="lookup-timeline-item lookup-timeline-item--${escapePointsHtml(tone)}">
            <span class="lookup-timeline-item__icon"><i class="${escapePointsHtml(icon)}"></i></span>
            <div class="lookup-timeline-item__content">
                <div class="lookup-timeline-item__title">${escapePointsHtml(title)}</div>
                ${meta ? `<div class="lookup-timeline-item__meta">${escapePointsHtml(meta)}</div>` : ''}
                ${detail ? `<div class="lookup-timeline-item__detail">${escapePointsHtml(detail)}</div>` : ''}
            </div>
        </li>
    `;
}

function buildPointsLookupActionButton({
    action = '',
    label = '',
    icon = 'fas fa-arrow-right',
    dataAttrs = {},
    tone = 'default',
    disabled = false,
    title = ''
} = {}) {
    const attributes = Object.entries(dataAttrs || {})
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}="${escapePointsHtml(value)}"`)
        .join(' ');

    return `
        <button type="button" class="lookup-action-btn lookup-action-btn--${escapePointsHtml(tone)}" data-points-action="${escapePointsHtml(action)}" ${title ? `title="${escapePointsHtml(title)}"` : ''} ${attributes} ${disabled ? 'disabled' : ''}>
            <i class="${escapePointsHtml(icon)}"></i>
            <span>${escapePointsHtml(label)}</span>
        </button>
    `;
}

function buildPointsLookupCodeOpsPanel(data = {}) {
    const normalizedCode = String(data.code || '').trim();
    if (!normalizedCode) {
        return '';
    }

    const context = getPointsWriteContextState();
    const status = String(data.status || '').trim().toLowerCase();
    const writeDisabledTitle = context.canWrite ? '' : '请先将顶部站点切到 CN 或 INTL';

    const actionButtons = [
        buildPointsLookupActionButton({
            action: 'copy-code-item',
            label: '复制兑换码',
            icon: 'fas fa-copy',
            tone: 'subtle',
            dataAttrs: {
                'data-code': encodeURIComponent(normalizedCode)
            }
        }),
        status === 'pending'
            ? buildPointsLookupActionButton({
                action: 'set-code-expiry',
                label: '设置有效期',
                icon: 'fas fa-calendar-alt',
                tone: 'default',
                disabled: !context.canWrite,
                title: writeDisabledTitle,
                dataAttrs: {
                    'data-code': encodeURIComponent(normalizedCode),
                    'data-code-expiry': encodeURIComponent(data.expires_at || '')
                }
            })
            : '',
        status === 'pending'
            ? buildPointsLookupActionButton({
                action: 'disable-code',
                label: '禁用兑换码',
                icon: 'fas fa-ban',
                tone: 'danger',
                disabled: !context.canWrite,
                title: writeDisabledTitle,
                dataAttrs: {
                    'data-code': encodeURIComponent(normalizedCode)
                }
            })
            : '',
        status === 'used'
            ? buildPointsLookupActionButton({
                action: 'revoke-code',
                label: '撤销兑换',
                icon: 'fas fa-rotate-left',
                tone: 'danger',
                disabled: !context.canWrite,
                title: writeDisabledTitle,
                dataAttrs: {
                    'data-code': encodeURIComponent(normalizedCode)
                }
            })
            : '',
        status === 'disabled'
            ? buildPointsLookupActionButton({
                action: 'enable-code',
                label: '重新启用',
                icon: 'fas fa-check',
                tone: 'success',
                disabled: !context.canWrite,
                title: writeDisabledTitle,
                dataAttrs: {
                    'data-code': encodeURIComponent(normalizedCode)
                }
            })
            : ''
    ].filter(Boolean).join('');

    return `
        <section class="lookup-section lookup-section--ops">
            <div class="lookup-section__title">直接操作</div>
            <div class="lookup-ops-panel">
                <div class="lookup-ops-panel__copy">
                    <strong>在查询结果里直接处理这条兑换码</strong>
                    <p>复制兑换码、调整有效期或修改状态时，会沿用顶部站点筛选作为实际写入语境。</p>
                </div>
                <div class="points-site-context points-site-context--lookup-ops">
                    ${buildPointsSiteContextMarkup('batch')}
                </div>
                <div class="lookup-action-row lookup-action-row--ops">${actionButtons}</div>
            </div>
        </section>
    `;
}

function renderLookupEmptyState() {
    const resultDiv = document.getElementById('lookupResult');
    if (!resultDiv) {
        return;
    }

    clearPointsLookupFeedback();

    resultDiv.innerHTML = `
        <div class="lookup-card lookup-card--rich lookup-card--empty">
            <div class="lookup-empty-state__icon"><i class="fas fa-search"></i></div>
            <div class="lookup-empty-state__title">准备开始查询</div>
            <div class="lookup-empty-state__copy">输入兑换码、订单号或积分流水 ID 后查看完整状态与履历。</div>
        </div>
    `;
    setAdminPointsPanelVisible(resultDiv, true);
}

async function lookupCode() {
    const input = document.getElementById('lookupCodeInput');
    const code = input.value.trim(); // Do not uppercase immediately, UUIDs might be lowercase
    const resultDiv = document.getElementById('lookupResult');

    if (!code) {
        announcePointsAction('请输入兑换码或订单号', 'error');
        input?.focus();
        return;
    }

    clearPointsLookupFeedback();

    // Show loading state
    resultDiv.innerHTML = `
        <div class="lookup-card lookup-card--rich">
            <div class="lookup-query-type">查询中</div>
            <div class="lookup-status">🔍 正在检索兑换码、订单号与积分流水上下文...</div>
        </div>
    `;
    setAdminPointsPanelVisible(resultDiv, true);

    try {
        const payload = await fetchPointsLookupPayload({
            site: getPointsReadSite(),
            q: code
        });
        renderLookupResult(payload?.result || {}, payload?.kind === 'ledger' ? 'ledger' : 'code');

    } catch (err) {
        resultDiv.innerHTML = `
            <div class="lookup-card lookup-card--rich invalid">
                <div class="lookup-query-type">查询失败</div>
                <div class="lookup-status">❌ 未找到可用结果</div>
                <div class="lookup-section">
                    <div class="lookup-section__title">排查建议</div>
                    <div class="lookup-section__body">确认兑换码是否完整、订单号是否属于当前站点，或直接粘贴积分流水 UUID 再试一次。</div>
                </div>
                <div class="lookup-section">
                    <div class="lookup-section__title">错误详情</div>
                    <div class="lookup-section__body">${escapePointsHtml(err.message)}</div>
                </div>
            </div>
        `;
        setAdminPointsPanelVisible(resultDiv, true);
    }
}

function renderLookupResult(data, type) {
    const resultDiv = document.getElementById('lookupResult');

    if (type === 'ledger') {
        const reason = formatLedgerReason ? formatLedgerReason(data.reason, data.created_at, data.reference_id) : data.reason;
        const reasonText = reason.includes('<') ? reason.replace(/<[^>]+>/g, '') : reason;
        const userLabel = data.profiles?.username || data.profiles?.email || '未知用户';
        const actionButtons = [
            data.user_id
                ? buildPointsLookupActionButton({
                    action: 'navigate-user',
                    label: '前往用户',
                    icon: 'fas fa-user',
                    dataAttrs: {
                        'data-user-id': encodeURIComponent(data.user_id)
                    }
                })
                : '',
            data.batch_id && data.reference_id
                ? buildPointsLookupBatchAction('navigate-batch', data.batch_id, data.reference_id, '定位相关兑换码', 'fas fa-crosshairs')
                : ''
        ].filter(Boolean).join('');
        const fieldCards = [
            buildPointsLookupFieldCard('流水 ID', `<span class="code-value" title="${escapePointsHtml(data.id || '')}">${escapePointsHtml(data.id || '-')}</span>`, 'mono', { wide: true }),
            buildPointsLookupFieldCard('类型 / 原因', `<span class="text-warning">${escapePointsHtml(data.reason || '-')}</span>`, 'warm'),
            buildPointsLookupFieldCard('关联对象', `
                <span class="code-value admin-points-reference-id">${escapePointsHtml(data.reference_id || '-')}</span>
                ${data.prompt_title ? `<div class="lookup-prompt-title">Prompt: ${escapePointsHtml(data.prompt_title)}</div>` : ''}
            `, 'info', { wide: true }),
            buildPointsLookupFieldCard('变动金额', `<span class="value admin-points-ledger-amount ${data.amount >= 0 ? 'text-success' : 'text-danger'}">${data.amount >= 0 ? '+' : ''}${escapePointsHtml(data.amount || 0)} 积分</span>`, data.amount >= 0 ? 'success' : 'danger'),
            buildPointsLookupFieldCard('当前用户', `<span>${escapePointsHtml(userLabel)}</span>`, 'default'),
            buildPointsLookupFieldCard('创建时间', `<span class="value admin-points-lookup-value-sans">${escapePointsHtml(formatPointsLookupDateTime(data.created_at))}</span>`, 'default')
        ].join('');
        const timelineItems = [
            buildPointsLookupTimelineItem({
                title: '流水写入系统',
                meta: formatPointsLookupDateTime(data.created_at),
                detail: `${reasonText || '积分变动'} · ${data.amount >= 0 ? '+' : ''}${data.amount || 0} 积分`,
                tone: data.amount >= 0 ? 'used' : 'revoked',
                icon: data.amount >= 0 ? 'fas fa-arrow-trend-up' : 'fas fa-arrow-trend-down'
            }),
            buildPointsLookupTimelineItem({
                title: '关联对象已解析',
                meta: data.prompt_title ? 'Prompt 资产' : '引用记录',
                detail: data.prompt_title || data.reference_id || '当前流水没有额外引用对象',
                tone: 'info',
                icon: 'fas fa-link'
            })
        ].join('');

        resultDiv.innerHTML = `
            <div class="lookup-card lookup-card--rich valid">
                <div class="lookup-card__header lookup-card__header--hero">
                    <div class="lookup-card__headline lookup-card__headline--hero">
                        <div class="lookup-query-type">🧾 积分流水查询</div>
                        <div class="lookup-card__eyebrow">记录存在</div>
                        <div class="lookup-card__title">${escapePointsHtml(reasonText || '积分流水')}</div>
                        <div class="lookup-card__subtitle">流水 ${escapePointsHtml(String(data.id || '').slice(0, 8) || '-')} · ${escapePointsHtml(userLabel)} · ${escapePointsHtml(formatPointsGenerateSiteLabel(data.site || getPointsReadSite()))}</div>
                    </div>
                    <div class="lookup-card__status lookup-card__status--hero">
                        <span class="lookup-status-badge lookup-status-badge--${escapePointsHtml(data.amount >= 0 ? 'used' : 'revoked')}">
                            <i class="fas ${data.amount >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
                            ${escapePointsHtml(data.amount >= 0 ? '积分增加' : '积分扣减')}
                        </span>
                        ${actionButtons ? `<div class="lookup-action-row">${actionButtons}</div>` : ''}
                    </div>
                </div>

                <div class="points-inline-feedback-shell" id="pointsLookupInlineFeedback">${buildPointsInlineFeedbackMarkup(pointsLookupFeedbackState.message, pointsLookupFeedbackState.tone)}</div>
                <div class="lookup-summary-grid">
                    ${buildPointsLookupSummaryCard('变动金额', `${data.amount >= 0 ? '+' : ''}${data.amount || 0} 积分`, data.amount >= 0 ? 'success' : 'danger')}
                    ${buildPointsLookupSummaryCard('写入站点', formatPointsGenerateSiteLabel(data.site || getPointsReadSite()), 'info')}
                    ${buildPointsLookupSummaryCard('关联对象', data.prompt_title || data.reference_id || '无', 'default')}
                    ${buildPointsLookupSummaryCard('当前用户', userLabel, 'default')}
                </div>

                <div class="lookup-content-grid">
                    <section class="lookup-section lookup-section--fields">
                        <div class="lookup-section__title">关键字段</div>
                        <div class="lookup-field-grid">${fieldCards}</div>
                    </section>
                    <section class="lookup-section lookup-section--timeline">
                        <div class="lookup-section__title">履历时间线</div>
                        <ul class="lookup-timeline">${timelineItems}</ul>
                    </section>
                </div>
            </div>
        `;
        setAdminPointsPanelVisible(resultDiv, true);
        return;
    }

    const queryTypeLabel = data.query_type === 'order' ? '📦 订单号查询' : '🎫 兑换码查询';
    const statusMeta = getPointsLookupStatusMeta(data.status);
    const lookupOpsPanel = buildPointsLookupCodeOpsPanel(data);
    const actionButtons = [
        data.batch_id ? buildPointsLookupBatchAction(
            'navigate-batch',
            data.batch_id,
            data.code || '',
            data.code ? '定位到批次' : '前往批次',
            data.code ? 'fas fa-crosshairs' : 'fas fa-box-archive'
        ) : '',
        data.used_by_id ? buildPointsLookupActionButton({
            action: 'navigate-user',
            label: '前往用户',
            icon: 'fas fa-user',
            dataAttrs: {
                'data-user-id': encodeURIComponent(data.used_by_id)
            }
        }) : ''
    ].filter(Boolean).join('');

    const fieldCards = [
        data.code ? buildPointsLookupFieldCard('兑换码', `<span class="code-value">${escapePointsHtml(data.code)}</span>`, 'mono', { wide: true }) : '',
        data.external_order_id ? buildPointsLookupFieldCard('订单号', `<span class="code-value">${escapePointsHtml(data.external_order_id)}</span>`, 'mono') : '',
        data.batch_id ? buildPointsLookupFieldCard('所属批次', `
            <a href="#" class="batch-link" data-points-action="navigate-batch" data-batch-id="${encodeURIComponent(data.batch_id)}" data-code="${encodeURIComponent(data.code || '')}">
                📦 ${escapePointsHtml(data.batch_name || '未命名批次')}
            </a>
            ${data.code ? `<span class="lookup-inline-hint">打开后会自动定位这条兑换码</span>` : ''}
        `, 'info', { wide: true }) : '',
        buildPointsLookupFieldCard('套餐 / 面额', `<span>${escapePointsHtml(data.package_name || '-')} · ${escapePointsHtml(data.points || 0)} 分</span>`, 'default'),
        buildPointsLookupFieldCard('写入站点', `<span>${escapePointsHtml(formatPointsGenerateSiteLabel(data.site || getPointsReadSite()))}</span>`, 'default'),
        data.used_by ? buildPointsLookupFieldCard('使用者', `
            ${data.used_by_id
                ? `<a href="#" class="batch-link" data-points-action="navigate-user" data-user-id="${encodeURIComponent(data.used_by_id)}">👤 ${escapePointsHtml(data.used_by)}</a>`
                : `<span>👤 ${escapePointsHtml(data.used_by)}</span>`}
        `, 'default') : '',
        data.created_at ? buildPointsLookupFieldCard('生成时间', `<span class="value admin-points-lookup-value-sans">${escapePointsHtml(formatPointsLookupDateTime(data.created_at))}</span>`, 'default') : '',
        data.used_at ? buildPointsLookupFieldCard('使用时间', `<span class="value admin-points-lookup-value-sans">${escapePointsHtml(formatPointsLookupDateTime(data.used_at))}</span>`, 'success') : '',
        data.revoked_by ? buildPointsLookupFieldCard('撤销者', `<span>${escapePointsHtml(data.revoked_by)}</span>`, 'danger') : '',
        data.revoke_reason ? buildPointsLookupFieldCard('撤销原因', `<span class="value admin-points-lookup-value-danger">📝 ${escapePointsHtml(data.revoke_reason)}</span>`, 'danger') : '',
        data.revoked_at ? buildPointsLookupFieldCard('撤销时间', `<span class="value admin-points-lookup-value-sans">${escapePointsHtml(formatPointsLookupDateTime(data.revoked_at))}</span>`, 'danger') : '',
        data.expires_at ? buildPointsLookupFieldCard('过期时间', `<span class="value admin-points-lookup-value-sans">${escapePointsHtml(formatPointsLookupDateTime(data.expires_at))}</span>`, 'info') : ''
    ].filter(Boolean).join('');

    const timelineItems = [
        buildPointsLookupTimelineItem({
            title: '当前状态',
            meta: statusMeta.label,
            detail: data.valid ? '兑换码当前可继续使用。' : '兑换码已进入受限或终态，下面是完整履历。',
            tone: statusMeta.tone,
            icon: statusMeta.icon
        }),
        data.created_at ? buildPointsLookupTimelineItem({
            title: '兑换码已写入批次',
            meta: formatPointsLookupDateTime(data.created_at),
            detail: `${data.batch_name || '未命名批次'} · ${data.package_name || '未命名套餐'}`,
            tone: 'pending',
            icon: 'fas fa-ticket-alt'
        }) : '',
        data.used_at ? buildPointsLookupTimelineItem({
            title: '兑换码已完成使用',
            meta: formatPointsLookupDateTime(data.used_at),
            detail: data.used_by || '已有使用记录',
            tone: 'used',
            icon: 'fas fa-circle-check'
        }) : '',
        data.revoked_at ? buildPointsLookupTimelineItem({
            title: '兑换码已被撤销',
            meta: formatPointsLookupDateTime(data.revoked_at),
            detail: data.revoke_reason || data.revoked_by || '管理员执行撤销',
            tone: 'revoked',
            icon: 'fas fa-ban'
        }) : '',
        data.expires_at ? buildPointsLookupTimelineItem({
            title: '兑换码过期时间',
            meta: formatPointsLookupDateTime(data.expires_at),
            detail: data.status === 'expired' ? '该兑换码已过期' : '到期后将不可继续兑换',
            tone: 'expired',
            icon: 'fas fa-clock'
        }) : ''
    ].filter(Boolean).join('');

    resultDiv.innerHTML = `
        <div class="lookup-card lookup-card--rich ${data.valid ? 'valid' : 'invalid'}">
            <div class="lookup-card__header lookup-card__header--hero">
                <div class="lookup-card__headline lookup-card__headline--hero">
                    <div class="lookup-query-type">${queryTypeLabel}</div>
                    <div class="lookup-card__eyebrow">${data.valid ? '记录已命中' : '记录已归档'}</div>
                    <div class="lookup-card__title">${escapePointsHtml(data.code || data.external_order_id || data.batch_name || '兑换码记录')}</div>
                    <div class="lookup-card__subtitle">${escapePointsHtml(data.batch_name || data.package_name || '兑换码 / 订单排查结果')} · ${escapePointsHtml(formatPointsGenerateSiteLabel(data.site || getPointsReadSite()))}</div>
                </div>
                <div class="lookup-card__status lookup-card__status--hero">
                    <span class="lookup-status-badge lookup-status-badge--${escapePointsHtml(statusMeta.tone)}">
                        <i class="${escapePointsHtml(statusMeta.icon)}"></i>
                        ${escapePointsHtml(statusMeta.label)}
                    </span>
                    ${actionButtons ? `<div class="lookup-action-row">${actionButtons}</div>` : ''}
                </div>
            </div>

            <div class="points-inline-feedback-shell" id="pointsLookupInlineFeedback">${buildPointsInlineFeedbackMarkup(pointsLookupFeedbackState.message, pointsLookupFeedbackState.tone)}</div>
            <div class="lookup-summary-grid">
                ${buildPointsLookupSummaryCard('查询方式', data.query_type === 'order' ? '订单号' : '兑换码', 'info')}
                ${buildPointsLookupSummaryCard('当前状态', statusMeta.label, statusMeta.tone)}
                ${buildPointsLookupSummaryCard('套餐 / 面额', `${data.package_name || '未命名套餐'} · ${data.points || 0} 分`, 'default')}
                ${buildPointsLookupSummaryCard('写入站点', formatPointsGenerateSiteLabel(data.site || getPointsReadSite()), 'default')}
            </div>

            ${lookupOpsPanel}

            <div class="lookup-content-grid">
                <section class="lookup-section lookup-section--fields">
                    <div class="lookup-section__title">关键字段</div>
                    <div class="lookup-field-grid">${fieldCards}</div>
                </section>
                <section class="lookup-section lookup-section--timeline">
                    <div class="lookup-section__title">履历时间线</div>
                    <ul class="lookup-timeline">${timelineItems}</ul>
                </section>
            </div>
        </div>
    `;
    setAdminPointsPanelVisible(resultDiv, true);
}

// Navigate to batch management and open specific batch
function navigateToBatch(batchId, options = {}) {
    const normalizedBatchId = String(batchId || '').trim();
    const normalizedCode = String(options?.code || '').trim();

    switchPointsView('batches');

    // Wait for tab switch, then open batch details
    if (normalizedBatchId) {
        schedulePointsBatchOpen(normalizedBatchId, {
            code: normalizedCode,
            delayMs: 200
        });
    }
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
    clearPointsBatchListFeedback();
    clearPendingPointsBatchCodeFocus();
    clearPendingPointsBatchOpen();

    const pointsModule = document.getElementById('module-points');
    if (!pointsModule?.classList.contains('active')) {
        return;
    }

    const hadOpenBatchDetail = Boolean(window.__pointsSiteChangeClosedBatchDetail)
        || Boolean(document.querySelector('.codes-modal-overlay') && String(window.currentViewBatchId || '').trim());
    window.__pointsSiteChangeClosedBatchDetail = false;
    if (document.querySelector('.codes-modal-overlay')) {
        closeCodesModal();
    }

    const dismissedOverlays = dismissPointsSiteScopedOverlaysOnSiteChange();
    renderPointsSiteContexts();
    syncPointsPackageDeleteModalState();
    syncPointsBatchEditModalState();
    syncPointsCodeActionModalState();
    syncPointsBatchInvalidateModalState();

    const activeView = document.querySelector('#module-points .view-section.active')?.id || '';
    clearPointsLookupResult({ renderEmptyState: activeView === 'points-view-lookup' });

    if (dismissedOverlays.length > 0) {
        announcePointsAction(`已切换站点，旧站点的${dismissedOverlays.join('、')}弹窗已关闭。`, 'info');
    }

    if (activeView === 'points-view-catalog') {
        await loadPointsPackageCatalog({ force: true });
        schedulePointsViewPrefetch('catalog');
        return;
    }

    if (activeView === 'points-view-batches') {
        await loadBatches();
        if (hadOpenBatchDetail) {
            setPointsBatchListFeedback('已切换站点，原来的批次详情已关闭，请在当前站点重新选择批次。', 'info', 'action');
        } else {
            await syncCurrentPointsBatchDetailAfterListReload({
                onMissing: () => {
                    setPointsBatchListFeedback('已切换站点，原来的批次详情已关闭，请在当前站点重新选择批次。', 'info', 'action');
                }
            });
        }
        schedulePointsViewPrefetch('batches');
        return;
    }

    if (activeView === 'points-view-generate') {
        await loadPackagesForSelect();
        initBatchExpiresPicker();
        renderPointsGeneratePreview();
        schedulePointsViewPrefetch('generate');
        return;
    }

    if (activeView === 'points-view-lookup') {
        schedulePointsViewPrefetch('lookup');
        return;
    }

    schedulePointsViewPrefetch(activeView.replace(/^points-view-/, '') || 'batches');
});
