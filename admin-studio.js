/* ========================================
   ADMIN STUDIO - JavaScript
   AI-Powered Prompt Upload System
   ======================================== */

// ========================================
// CONFIGURATION
// ========================================
const GEMINI_MODEL = 'gemini-2.5-flash';

// State
let uploadedFiles = [];
let analysisResult = null;
window.currentUserPermissions = [];
window.isSuperAdmin = false;
window.isAdmin = false;
window.adminStudioAccessGranted = false;

function sanitizeImageUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';

    const trimmed = url.trim();
    if (trimmed.startsWith('data:image/')) return trimmed;

    try {
        const parsed = new URL(trimmed, window.location.origin);
        if (['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
            return parsed.href;
        }
    } catch (err) {
        console.warn('Blocked unsafe image URL:', trimmed, err);
    }

    return '';
}

async function auditPromptAction(actionType, details = {}) {
    if (typeof window.logAdminAction !== 'function') return;

    try {
        await window.logAdminAction(actionType, null, details);
    } catch (err) {
        console.warn('Prompt audit log failed:', err);
    }
}

// ========================================
// THEME INITIALIZATION - Sync with Gallery
// ========================================
(function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    // Default to dark if not set, or use saved preference
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
})();

// Listen for theme changes from other tabs (Gallery)
window.addEventListener('storage', (e) => {
    if (e.key === 'theme') {
        if (e.newValue === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    }
});

// ========================================
// INITIALIZATION
// ========================================
function setAdminStudioAccessState(nextState) {
    const body = document.body;
    if (!body) return;

    body.classList.remove('admin-access-pending', 'admin-access-denied', 'admin-access-granted');
    body.classList.add(`admin-access-${nextState}`);
}

function renderAdminStudioAccessGate(state, options = {}) {
    const titleEl = document.getElementById('adminAccessTitle');
    const messageEl = document.getElementById('adminAccessMessage');
    const iconEl = document.getElementById('adminAccessIcon');
    const primaryAction = document.getElementById('adminAccessPrimaryAction');
    const secondaryAction = document.getElementById('adminAccessSecondaryAction');

    setAdminStudioAccessState(state);

    if (titleEl) {
        titleEl.textContent = options.title || (state === 'pending' ? '正在校验后台访问权限' : '无法访问 Admin Studio');
    }

    if (messageEl) {
        messageEl.textContent = options.message || (state === 'pending'
            ? '请稍候，我们正在确认当前账号是否拥有 Admin Studio 访问权限。'
            : '当前账号没有后台访问权限。');
    }

    if (iconEl) {
        iconEl.innerHTML = state === 'pending'
            ? '<i class="fas fa-shield-alt"></i>'
            : '<i class="fas fa-lock"></i>';
    }

    if (primaryAction) {
        primaryAction.textContent = options.primaryLabel || '返回首页';
        primaryAction.href = options.primaryHref || 'index.html';
        primaryAction.style.display = '';
    }

    if (secondaryAction) {
        if (options.secondaryLabel) {
            secondaryAction.textContent = options.secondaryLabel;
            secondaryAction.href = options.secondaryHref || 'index.html';
            secondaryAction.style.display = '';
        } else {
            secondaryAction.style.display = 'none';
        }
    }
}

function applyResolvedAdminAccess(access = {}) {
    window.isSuperAdmin = Boolean(access.isSuperAdmin);
    window.isAdmin = Boolean(access.isAdmin);
    window.currentUserPermissions = Array.isArray(access.permissions) ? access.permissions : [];
    window.adminStudioAccessGranted = Boolean(access.isAdmin);

    console.log('🛡️ Permissions loaded:', {
        isSuperAdmin: window.isSuperAdmin,
        permissions: window.currentUserPermissions
    });

    window.dispatchEvent(new CustomEvent('adminStudioAccessGranted'));
    window.dispatchEvent(new CustomEvent('permissionsLoaded'));
    updateUIBasedOnPermissions();
}

async function requireAdminStudioAccess() {
    renderAdminStudioAccessGate('pending');

    const accessClient = window.AdminAccess;
    if (!accessClient?.getCurrentAdminAccess) {
        renderAdminStudioAccessGate('denied', {
            title: '后台权限校验不可用',
            message: '当前页面缺少管理员权限校验模块，请刷新页面后重试。如果问题持续存在，请联系站点维护者。',
            secondaryLabel: '刷新重试',
            secondaryHref: 'admin-studio.html'
        });
        return null;
    }

    const access = await accessClient.getCurrentAdminAccess({ forceRefresh: true });

    if (!access?.user) {
        renderAdminStudioAccessGate('denied', {
            title: '请先登录管理员账号',
            message: 'Admin Studio 现在要求先登录再校验权限。请返回首页登录后重新进入后台。',
            secondaryLabel: '返回登录',
            secondaryHref: 'index.html'
        });
        return null;
    }

    if (!access.isAdmin) {
        renderAdminStudioAccessGate('denied', {
            title: '当前账号没有后台访问权限',
            message: '你已经登录，但当前账号不是管理员或未分配后台权限，因此不能进入 Admin Studio。',
            secondaryLabel: '切换账号',
            secondaryHref: 'index.html'
        });
        return null;
    }

    applyResolvedAdminAccess(access);
    renderAdminStudioAccessGate('granted');
    return access;
}

function initializeAdminStudioShell() {
    bindAdminStudioDelegatedControls();
    initUploadZone();
    initForm();
    initCustomDropdown();
    checkApiKey();
    initStarrySky(); // New: Starry background
    initBatchOperations();

    // Initialize admin site filter selector
    if (window.AdminSiteFilter) window.AdminSiteFilter.renderSiteSelector();

    // Initialize system config if available
    if (typeof initSystemConfig === 'function') {
        initSystemConfig();
    }

    // Load manage view if switching to it
    const manageTab = document.querySelector('[data-view="manage"]');
    if (manageTab) {
        manageTab.addEventListener('click', () => loadAdminPrompts());
    }
}

function bindAdminStudioDelegatedControls() {
    if (document.documentElement.dataset.adminStudioDelegatesBound === '1') {
        return;
    }

    document.documentElement.dataset.adminStudioDelegatesBound = '1';

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-admin-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.adminAction) {
            case 'switch-module':
                window.switchModule?.(actionEl.dataset.moduleId);
                break;
            case 'close-mobile-sidebar':
                window.closeMobileSidebar?.();
                break;
            case 'toggle-mobile-sidebar':
                window.toggleMobileSidebar?.();
                break;
            case 'switch-gallery-view':
                window.switchView?.(actionEl.dataset.view);
                break;
            case 'gallery-reset-form':
                window.resetForm?.();
                break;
            case 'switch-comment-view':
                window.switchCommentView?.(actionEl.dataset.commentView);
                break;
            case 'comments-export':
                window.exportData?.(actionEl.dataset.exportFormat);
                break;
            case 'comments-switch-layout':
                window.switchLayoutView?.(actionEl.dataset.view);
                break;
            case 'comments-batch-delete':
                window.batchDeleteComments?.();
                break;
            case 'switch-settings-view':
                window.switchSettingsView?.(actionEl.dataset.settingsView);
                break;
            case 'settings-toggle-custom-dropdown':
                window.toggleCustomDropdown?.(actionEl.dataset.dropdownId);
                break;
            case 'settings-select-dropdown-option':
                window.selectDropdownOption?.(
                    actionEl.dataset.dropdownId,
                    actionEl.dataset.optionValue,
                    actionEl.dataset.optionLabel
                );
                break;
            case 'settings-add-api-key':
                window.addNewApiKey?.();
                break;
            case 'settings-add-package-row':
                window.addPackageRow?.();
                break;
            case 'settings-add-channel':
                window.addChannel?.();
                break;
            case 'settings-delete-channel': {
                const index = parseInt(actionEl.dataset.channelIndex || '', 10);
                if (!Number.isNaN(index)) {
                    window.deleteChannel?.(index);
                }
                break;
            }
            case 'settings-prompt-api-key':
                window.promptForApiKey?.();
                break;
            case 'settings-delete-api-key':
                window.deleteApiKey?.();
                break;
            case 'settings-select-affiliate-poster-template':
                window.selectAffiliatePosterTemplate?.(actionEl.dataset.posterTemplateId);
                break;
            case 'settings-reset-affiliate-poster-background':
                window.resetAffiliatePosterBackground?.(actionEl.dataset.posterTemplateId);
                break;
            case 'settings-rich-text-format':
                window.AdminRichTextEditor?.insertFormat?.(
                    actionEl.dataset.richTextKey,
                    actionEl.dataset.richTextFormat
                );
                break;
            case 'settings-rich-text-toggle-align-picker':
                window.AdminRichTextEditor?.toggleAlignPicker?.(actionEl.dataset.richTextKey);
                break;
            case 'settings-rich-text-apply-align':
                window.AdminRichTextEditor?.applyTextAlign?.(
                    actionEl.dataset.richTextKey,
                    actionEl.dataset.richTextAlign
                );
                break;
            case 'settings-rich-text-insert-link':
                window.AdminRichTextEditor?.insertLink?.(actionEl.dataset.richTextKey);
                break;
            case 'settings-rich-text-toggle-emoji-picker':
                window.AdminRichTextEditor?.toggleEmojiPicker?.(actionEl.dataset.richTextKey);
                break;
            case 'settings-rich-text-select-emoji':
                window.AdminRichTextEditor?.selectEmoji?.(
                    actionEl.dataset.richTextKey,
                    actionEl.dataset.richTextEmoji
                );
                break;
            case 'settings-rich-text-toggle-dropdown':
                window.AdminRichTextEditor?.toggleDropdown?.(
                    actionEl.dataset.richTextKey,
                    actionEl.dataset.richTextDropdown
                );
                break;
            case 'settings-rich-text-select-color':
                window.AdminRichTextEditor?.selectColor?.(
                    actionEl.dataset.richTextKey,
                    actionEl.dataset.richTextColor
                );
                break;
            case 'settings-rich-text-select-font-size':
                window.AdminRichTextEditor?.selectFontSize?.(
                    actionEl.dataset.richTextKey,
                    actionEl.dataset.richTextSize,
                    actionEl.dataset.richTextSizeClass
                );
                break;
            case 'settings-toggle-custom-recharge-entry':
                window.toggleCustomRechargeEntryStatus?.();
                break;
            case 'settings-toggle-mock-payment':
                window.toggleMockPaymentStatus?.();
                break;
            case 'settings-toggle-package-status': {
                const index = parseInt(actionEl.dataset.packageIndex || '', 10);
                if (!Number.isNaN(index)) {
                    window.togglePackageStatus?.(index);
                }
                break;
            }
            case 'settings-delete-package': {
                const index = parseInt(actionEl.dataset.packageIndex || '', 10);
                if (!Number.isNaN(index)) {
                    window.deletePackage?.(index);
                }
                break;
            }
            case 'settings-save-seo':
                window.saveSeoSettings?.();
                break;
            case 'settings-export-dataset':
                window.exportSettingsData?.(
                    actionEl.dataset.exportDataset,
                    actionEl.dataset.exportFormat
                );
                break;
            case 'homepage-switch-section':
                window.HomepageAdmin?.switchSection?.(actionEl.dataset.hpSection);
                break;
            case 'homepage-toggle-visible':
                window.HomepageAdmin?.toggleVisible?.(actionEl.dataset.homepageSection);
                break;
            case 'homepage-toggle-field':
                window.HomepageAdmin?.toggleField?.(
                    actionEl.dataset.homepageSection,
                    actionEl.dataset.homepageField
                );
                break;
            case 'homepage-save-section':
                window.HomepageAdmin?.saveSection?.(actionEl.dataset.homepageSection);
                break;
            case 'homepage-toggle-config-card':
                window.toggleConfigCard?.(actionEl);
                break;
            case 'homepage-upload-screenshot':
                document.getElementById('hp-verify-file-input')?.click();
                break;
            case 'payments-switch-tab':
                window.AdminPayments?.switchTab?.(actionEl.dataset.tab);
                break;
            case 'payments-toggle-provider-panel':
                window.togglePaymentProviderPanel?.(actionEl.dataset.provider);
                break;
            case 'payments-toggle-provider-enabled':
                window.togglePaymentProviderEnabled?.(actionEl.dataset.provider);
                break;
            case 'payments-save-channel-settings':
                window.savePaymentChannelSettings?.();
                break;
            case 'payments-toggle-range-menu':
                window.AdminPayments?.toggleRangeMenu?.(event);
                break;
            case 'payments-set-days':
                window.AdminPayments?.setDays?.(Number(actionEl.dataset.days || 0), true);
                break;
            case 'payments-apply-custom-range':
                window.AdminPayments?.applyCustomRange?.();
                break;
            case 'payments-export':
                window.AdminPayments?.exportData?.(actionEl.dataset.exportFormat);
                break;
            case 'payments-reload':
                window.AdminPayments?.reload?.();
                break;
            case 'payments-handle-anomaly-action':
                window.AdminPayments?.handleAnomalyAction?.(
                    actionEl.dataset.paymentsTargetType,
                    actionEl.dataset.paymentsTargetId,
                    actionEl.dataset.paymentsAction
                );
                break;
            case 'payments-go-to-page':
                window.AdminPayments?.goToPage?.(
                    actionEl.dataset.paymentsPageKey,
                    Number(actionEl.dataset.paymentsPage || 0)
                );
                break;
            case 'payments-set-exception-topic-filter':
                window.AdminPayments?.setExceptionTopicFilter?.(actionEl.dataset.paymentsTopicKey);
                break;
            case 'payments-preview-cleanup':
                window.AdminPayments?.previewCleanup?.();
                break;
            case 'payments-run-cleanup':
                window.AdminPayments?.cleanupTestData?.();
                break;
            case 'site-filter-toggle-dropdown':
                window.AdminSiteFilter?.toggleDropdown?.();
                break;
            case 'site-filter-select':
                window.AdminSiteFilter?.select?.(actionEl.dataset.siteFilterValue);
                break;
            case 'analytics-dismiss-alerts':
                window.dismissAllAlerts?.();
                break;
            case 'analytics-switch-tab':
                window.switchAnalyticsTab?.(actionEl.dataset.tab);
                break;
            case 'analytics-toggle-range-dropdown':
                window.toggleDateRangeDropdown?.();
                break;
            case 'analytics-select-preset-range':
                window.selectPresetRange?.(Number(actionEl.dataset.range || 0));
                break;
            case 'analytics-toggle-inline-calendar':
                window.toggleInlineCalendar?.(event);
                break;
            case 'analytics-inline-select-date':
                event.stopPropagation();
                window.selectInlineDate?.(
                    Number(actionEl.dataset.analyticsYear || 0),
                    Number(actionEl.dataset.analyticsMonth || 0),
                    Number(actionEl.dataset.analyticsDay || 0),
                    event
                );
                break;
            case 'analytics-change-inline-month':
                window.changeInlineMonth?.(Number(actionEl.dataset.monthDelta || 0));
                break;
            case 'analytics-reset-inline-calendar':
                window.resetInlineCalendar?.();
                break;
            case 'analytics-set-inline-today':
                window.setInlineToday?.();
                break;
            case 'analytics-apply-custom-range':
                window.applyCustomRange?.();
                break;
            case 'analytics-export-data':
                window.exportAnalyticsData?.(actionEl.dataset.analyticsExportFormat);
                break;
            case 'analytics-refresh-data':
                window.refreshAllAnalytics?.();
                break;
            case 'analytics-view-context':
                window.viewPromptContext?.(actionEl.dataset.promptId);
                break;
            case 'analytics-range-select-date':
                event.stopPropagation();
                window.selectRangeDate?.(
                    Number(actionEl.dataset.analyticsYear || 0),
                    Number(actionEl.dataset.analyticsMonth || 0),
                    Number(actionEl.dataset.analyticsDay || 0)
                );
                break;
            case 'analytics-range-change-month':
                event.stopPropagation();
                window.changeMonth?.(
                    actionEl.dataset.calendarType || 'start',
                    Number(actionEl.dataset.monthDelta || 0)
                );
                break;
            case 'analytics-range-reset':
                event.stopPropagation();
                window.resetDateRange?.();
                break;
            case 'analytics-range-apply':
                event.stopPropagation();
                window.applyAndClose?.();
                break;
            case 'analytics-load-ai-prediction':
                window.loadAIPrediction?.();
                break;
            case 'analytics-open-experiment-modal':
                window.openExperimentModal?.();
                break;
            case 'analytics-load-experiments-list':
                window.loadExperimentsList?.();
                break;
            case 'analytics-close-ab-results-chart':
                window.closeABResultsChart?.();
                break;
            case 'analytics-close-experiment-modal':
                window.closeExperimentModal?.();
                break;
            case 'analytics-add-variant-row':
                window.addVariantRow?.();
                break;
            case 'analytics-remove-variant-row':
                actionEl.closest('.variant-row')?.remove();
                break;
            case 'analytics-show-ab-results': {
                const experimentId = decodeURIComponent(actionEl.dataset.experimentId || '');
                const experimentName = decodeURIComponent(actionEl.dataset.experimentName || '');
                let variants = [];
                try {
                    variants = JSON.parse(decodeURIComponent(actionEl.dataset.experimentVariants || '%5B%5D'));
                } catch (err) {
                    console.warn('Failed to parse experiment variants payload', err);
                }
                window.showABResults?.(experimentId, experimentName, variants);
                break;
            }
            case 'points-switch-view':
                window.switchPointsView?.(actionEl.dataset.pointsViewTarget);
                break;
            case 'points-toggle-date-filter':
                window.toggleBatchDateFilter?.();
                break;
            case 'points-filter-date':
                window.filterBatchByDate?.(actionEl.dataset.batchDate);
                break;
            case 'points-toggle-channel-filter':
                window.toggleBatchChannelFilter?.();
                break;
            case 'points-filter-channel':
                window.filterBatchByChannel?.(actionEl.dataset.batchChannel);
                break;
            case 'points-toggle-package-filter':
                window.toggleBatchPackageFilter?.();
                break;
            case 'points-filter-package':
                window.filterBatchByPackage?.(actionEl.dataset.batchPackage);
                break;
            case 'points-toggle-export-menu':
                window.toggleBatchExportMenu?.();
                break;
            case 'points-export-batch-list':
                window.exportBatchList?.();
                break;
            case 'points-export-selected-batches':
                window.exportSelectedBatches?.();
                break;
            case 'points-toggle-select-mode':
                window.toggleBatchSelectMode?.();
                break;
            case 'points-toggle-actions-menu':
                window.togglePointsBatchActionsMenu?.();
                break;
            case 'points-batch-invalidate':
                window.batchInvalidateCodes?.();
                break;
            case 'points-batch-delete':
                window.batchDeleteBatches?.();
                break;
            case 'points-sort-batches':
                window.sortBatches?.(actionEl.dataset.sortField);
                break;
            case 'points-copy-all-codes':
                window.copyAllCodes?.();
                break;
            case 'points-download-codes-csv':
                window.downloadCodesCSV?.();
                break;
            case 'points-lookup-code':
                window.lookupCode?.();
                break;
            case 'users-toggle-status-filter':
                window.toggleUserStatusFilter?.();
                break;
            case 'users-filter-status':
                window.filterUserByStatus?.(actionEl.dataset.userStatus);
                break;
            case 'users-toggle-level-filter':
                window.toggleUserLevelFilter?.();
                break;
            case 'users-filter-level':
                window.filterUserByLevel?.(actionEl.dataset.userLevel);
                break;
            case 'users-toggle-role-filter':
                window.toggleUserRoleFilter?.();
                break;
            case 'users-filter-role':
                window.filterUserByRole?.(actionEl.dataset.userRole);
                break;
            case 'users-toggle-select-mode':
                window.toggleUserSelectMode?.();
                break;
            case 'users-toggle-batch-menu':
                window.toggleUserBatchMenu?.();
                break;
            case 'users-select-all-page':
                window.selectAllUsersOnPage?.();
                break;
            case 'users-batch-send-notification':
                window.batchSendNotification?.();
                break;
            case 'users-batch-adjust-points':
                window.batchAdjustPoints?.();
                break;
            case 'users-batch-add-tags':
                window.batchAddTags?.();
                break;
            case 'users-batch-export':
                window.batchExportUsers?.();
                break;
            case 'users-batch-ban':
                window.batchBanUsers?.();
                break;
            case 'users-close-modal':
                window.closeUserModal?.();
                break;
            case 'users-switch-tab':
                window.switchUserTab?.(actionEl.dataset.userTab);
                break;
            case 'settings-toggle-decoration':
                window.toggleDecoration?.();
                break;
            case 'settings-toggle-custom-dropdown':
                window.toggleCustomDropdown?.(actionEl.dataset.dropdownId);
                break;
            case 'settings-select-dropdown-option':
                window.selectDropdownOption?.(
                    actionEl.dataset.dropdownId,
                    actionEl.dataset.optionValue,
                    actionEl.dataset.optionLabel
                );
                break;
            case 'settings-save-login-security':
                window.saveLoginSecuritySettings?.();
                break;
            case 'settings-refresh-locked-accounts':
                window.refreshLockedAccounts?.();
                break;
            case 'settings-unlock-account':
                window.unlockAccount?.(actionEl.dataset.userId);
                break;
            case 'settings-unlock-all-accounts':
                window.unlockAllAccounts?.();
                break;
            case 'settings-save-ip-blacklist':
                window.saveIpBlacklist?.();
                break;
            case 'settings-check-verify-quota':
                window.checkVerifyQuota?.();
                break;
            case 'settings-add-api-key':
                window.addNewApiKey?.();
                break;
            case 'settings-select-decoration':
                window.selectDecoration?.(actionEl.dataset.decorationTheme);
                break;
            case 'settings-toggle-page-target':
                window.togglePageTarget?.(actionEl.dataset.targetPage);
                break;
            case 'settings-insert-format':
                window.insertFormat?.(actionEl.dataset.formatTag);
                break;
            case 'settings-toggle-align-picker':
                window.toggleAlignPicker?.();
                break;
            case 'settings-apply-text-align':
                window.applyTextAlign?.(actionEl.dataset.textAlign);
                break;
            case 'settings-insert-link':
                window.insertLink?.();
                break;
            case 'settings-toggle-emoji-picker':
                window.toggleEmojiPicker?.();
                break;
            case 'settings-select-emoji':
                window.selectEmoji?.(actionEl.dataset.emojiValue);
                break;
            case 'settings-toggle-toolbar-dropdown':
                window.toggleDropdown?.(actionEl.dataset.dropdownId);
                break;
            case 'settings-select-color':
                window.selectColor?.(actionEl.dataset.colorValue);
                break;
            case 'settings-select-font-size':
                window.selectFontSize?.(actionEl.dataset.fontSizeValue, actionEl.dataset.fontSizeClass);
                break;
            case 'settings-save-announcement':
                window.saveAnnouncement?.();
                break;
            case 'settings-save-sensitive-words':
                window.saveSensitiveWords?.();
                break;
            case 'discounts-filter':
                window.AdminDiscounts?.filter?.(actionEl.dataset.discountStatus, actionEl);
                break;
            case 'discounts-open-generate-modal':
                window.AdminDiscounts?.openGenerateModal?.();
                break;
            case 'discounts-copy-code':
                window.AdminDiscounts?.copyCode?.(actionEl.dataset.discountCode || '');
                break;
            case 'discounts-toggle-status':
                window.AdminDiscounts?.toggleStatus?.(
                    actionEl.dataset.discountId,
                    actionEl.dataset.discountNextActive === 'true'
                );
                break;
            case 'discounts-delete-code':
                window.AdminDiscounts?.deleteCode?.(
                    actionEl.dataset.discountId,
                    actionEl.dataset.discountCode || ''
                );
                break;
            case 'discounts-close-generate-modal':
                window.AdminDiscounts?.closeGenerateModal?.();
                break;
            case 'discounts-toggle-type-dropdown':
                window.AdminDiscounts?.toggleTypeDropdown?.();
                break;
            case 'discounts-select-type':
                window.AdminDiscounts?.selectDiscountType?.(actionEl.dataset.discountType);
                break;
            case 'discounts-submit-generate':
                window.AdminDiscounts?.submitGenerate?.();
                break;
            case 'discounts-pagination-go': {
                const page = parseInt(actionEl.dataset.discountPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.AdminDiscounts?.goToPage?.(page);
                }
                break;
            }
            case 'tickets-filter':
                window.AdminTickets?.filter?.(actionEl.dataset.ticketStatus, actionEl);
                break;
            case 'tickets-close-reply-modal':
                window.AdminTickets?.closeReplyModal?.();
                break;
            case 'tickets-submit-reply':
                window.AdminTickets?.submitReply?.();
                break;
            case 'tickets-pagination-go': {
                const page = parseInt(actionEl.dataset.ticketPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.AdminTickets?.changePage?.(page);
                }
                break;
            }
            default:
                break;
        }
    });

    document.addEventListener('change', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-admin-change-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.adminChangeAction) {
            case 'comments-toggle-select-all':
                window.toggleSelectAll?.();
                break;
            case 'payments-change-active-provider':
                window.handlePaymentChannelActiveChange?.(actionEl.value);
                break;
            case 'points-toggle-select-all-batches':
                window.toggleSelectAllBatches?.();
                break;
            case 'homepage-handle-screenshot-upload':
                window.HomepageAdmin?._handleScreenshotUpload?.(actionEl);
                break;
            case 'users-toggle-test-accounts':
                window.toggleUserTestAccountVisibility?.(actionEl.checked);
                break;
            case 'settings-update-package-field': {
                const index = parseInt(actionEl.dataset.packageIndex || '', 10);
                if (Number.isNaN(index)) {
                    break;
                }

                let value = actionEl.value;
                switch (actionEl.dataset.packageValueType) {
                    case 'int': {
                        const parsed = parseInt(actionEl.value || '', 10);
                        value = Number.isFinite(parsed) ? parsed : 0;
                        actionEl.value = String(value);
                        break;
                    }
                    case 'float': {
                        const trimmed = String(actionEl.value || '').trim();
                        if (!trimmed) {
                            value = null;
                            actionEl.value = '';
                            break;
                        }

                        const parsed = parseFloat(trimmed);
                        value = Number.isFinite(parsed) ? parsed : null;
                        actionEl.value = value == null ? '' : String(value);
                        break;
                    }
                    default:
                        value = String(actionEl.value || '').trim();
                        actionEl.value = value;
                        break;
                }

                window.updatePackage?.(index, actionEl.dataset.packageField, value);
                break;
            }
            case 'settings-toggle-decoration':
                window.toggleDecoration?.();
                break;
            case 'settings-save-verify-config':
                window.saveVerifyConfig?.();
                break;
            case 'affiliate-save-setting': {
                const field = actionEl.dataset.affiliateSettingField;
                const value = actionEl.dataset.affiliateValueSource === 'checked-bool'
                    ? (actionEl.checked ? 'true' : 'false')
                    : actionEl.value;
                window.saveAffiliateSetting?.(field, value);
                break;
            }
            case 'affiliate-save-poster-field':
                window.saveAffiliatePosterField?.(actionEl.dataset.affiliatePosterField, actionEl.value);
                break;
            case 'settings-affiliate-poster-upload':
                window.handleAffiliatePosterUpload?.(actionEl.dataset.posterTemplateId, actionEl);
                break;
            case 'discounts-pagination-go': {
                const page = parseInt(actionEl.value || '', 10);
                if (!Number.isNaN(page)) {
                    window.AdminDiscounts?.goToPage?.(page);
                }
                break;
            }
            case 'tickets-pagination-go': {
                const page = parseInt(actionEl.value || '', 10);
                if (!Number.isNaN(page)) {
                    window.AdminTickets?.changePage?.(page);
                }
                break;
            }
            default:
                break;
        }
    });

    document.addEventListener('focusin', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const actionEl = target?.closest?.('[data-admin-focus-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.adminFocusAction) {
            case 'settings-verify-api-key-unlock':
                actionEl.removeAttribute('readonly');
                break;
            default:
                break;
        }
    });

    document.addEventListener('focusout', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const actionEl = target?.closest?.('[data-admin-blur-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.adminBlurAction) {
            case 'settings-verify-api-key-lock':
                actionEl.setAttribute('readonly', 'readonly');
                break;
            default:
                break;
        }
    });

    document.addEventListener('input', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-admin-input-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.adminInputAction) {
            case 'discounts-search':
                window.AdminDiscounts?.search?.();
                break;
            case 'discounts-format-expiry-date':
                window.AdminDiscounts?.formatExpiryDateInput?.(actionEl);
                break;
            case 'discounts-format-expiry-time':
                window.AdminDiscounts?.formatExpiryTimeInput?.(actionEl);
                break;
            case 'tickets-search':
                window.AdminTickets?.search?.();
                break;
            default:
                break;
        }
    });

    document.addEventListener('keydown', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-admin-keydown-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.adminKeydownAction) {
            case 'points-search-enter':
                if (event.key === 'Enter') {
                    event.preventDefault();
                    window.searchCodeInBatches?.();
                }
                break;
            default:
                break;
        }
    });

    document.addEventListener('submit', (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        if (!form) {
            return;
        }

        if (form.id === 'generateCodesForm') {
            window.generateCodes?.(event);
            return;
        }

        if (form.id === 'discountGenerateForm') {
            event.preventDefault();
            window.AdminDiscounts?.submitGenerate?.();
            return;
        }

        if (form.id === 'ticketReplyForm') {
            event.preventDefault();
            window.AdminTickets?.submitReply?.();
            return;
        }

        if (form.id === 'experimentForm') {
            event.preventDefault();
            window.handleCreateExperiment?.(event);
        }
    });

    document.addEventListener('click', (event) => {
        const overlay = event.target instanceof HTMLElement && event.target.matches('[data-admin-overlay-close]');
        if (!overlay || event.target !== overlay) {
            return;
        }

        switch (overlay.dataset.adminOverlayClose) {
            case 'discount-generate-modal':
                window.AdminDiscounts?.closeGenerateModal?.();
                break;
            case 'ticket-reply-modal':
                window.AdminTickets?.closeReplyModal?.();
                break;
            default:
                break;
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const access = await requireAdminStudioAccess();
    if (!access) return;
    initializeAdminStudioShell();
});

// ========================================
// ADMIN STATE
// ========================================
let currentMode = 'create'; // 'create' or 'edit'
let editingId = null;

// ========================================
// PERMISSION SYSTEM
// ========================================
window.loadUserPermissions = async function (options = {}) {
    try {
        const accessClient = window.AdminAccess;
        if (!accessClient?.getCurrentAdminAccess) {
            throw new Error('AdminAccess helper unavailable');
        }

        const access = await accessClient.getCurrentAdminAccess({
            forceRefresh: options.forceRefresh === true
        });

        if (!access?.user) {
            window.isSuperAdmin = false;
            window.isAdmin = false;
            window.currentUserPermissions = [];
            window.adminStudioAccessGranted = false;
            return null;
        }

        applyResolvedAdminAccess(access);
        return access;
    } catch (err) {
        console.warn('Failed to load permissions:', err);
        window.isSuperAdmin = false;
        window.isAdmin = false;
        window.currentUserPermissions = [];
        window.adminStudioAccessGranted = false;
        return null;
    }
};

window.hasPermission = function (permission) {
    if (window.isSuperAdmin) return true;
    return window.currentUserPermissions.includes(permission);
};

function updateUIBasedOnPermissions() {
    // Hide/Show sections based on permissions
    const manageTab = document.querySelector('[data-view="manage"]');
    if (manageTab && !hasPermission('prompts.manage') && !hasPermission('content.moderate')) {
        manageTab.style.display = 'none';
    }

    // Additional UI updates can be handled by respective modules listening to 'permissionsLoaded'
}

// ========================================
// VIEW SWITCHING
// ========================================
// Switch between Create and Manage views
function switchView(viewName) {
    // Update active tab buttons
    document.querySelectorAll('.admin-tab').forEach(tab => {
        const isActive = tab.dataset.view === viewName;
        tab.classList.toggle('active', isActive);

        // Update sliding indicator position
        if (isActive) {
            updateAdminTabIndicator(tab);
        }
    });

    // Update view visibility
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`view-${viewName}`).classList.add('active');

    // Load data if switching to Manage view
    if (viewName === 'manage') {
        loadAdminPrompts();
    }
}

// Switch between Settings sub-views (Pricing / General)
function switchSettingsView(viewName) {
    // Update active tab in settings module only
    const settingsModule = document.getElementById('module-settings');
    if (!settingsModule) return;

    settingsModule.querySelectorAll('.admin-tab').forEach(tab => {
        const isActive = tab.dataset.settingsView === viewName;
        tab.classList.toggle('active', isActive);

        if (isActive) {
            updateAdminTabIndicator(tab);
        }
    });

    // Update view visibility within settings
    settingsModule.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    const targetView = document.getElementById(`settings-view-${viewName}`);
    if (targetView) targetView.classList.add('active');

    // Load API keys when switching to general
    if (viewName === 'general') {
        renderApiKeySelector();
    }
}

// Initialize tab indicator (robust check)
function initIndicator() {
    // Update ALL active tab indicators in all navigation bars
    document.querySelectorAll('.admin-tabs').forEach(nav => {
        const activeTab = nav.querySelector('.admin-tab.active');
        if (activeTab) updateAdminTabIndicator(activeTab);
    });
}

// Run on DOMReady, Window Load, and Resize
setTimeout(initIndicator, 50);
window.addEventListener('load', initIndicator);
window.addEventListener('resize', () => {
    // Debounce slightly
    requestAnimationFrame(initIndicator);
});

// Update Admin Tab Indicator Position
// Update Admin Tab Indicator Position
function updateAdminTabIndicator(activeTab) {
    if (!activeTab) return;

    // Find the indicator within the same navigation container
    const nav = activeTab.closest('.admin-tabs');
    if (!nav) return;

    const indicator = nav.querySelector('.admin-tab-indicator');
    if (indicator) {
        // Ensure nav has relative positioning context (handled in CSS, but check anyway)
        const navRect = nav.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();

        // Calculate relative position to handle potential nested offsets
        const left = tabRect.left - navRect.left;

        indicator.style.left = `${left}px`;
        indicator.style.width = `${tabRect.width}px`;
        indicator.style.opacity = '1';
    }
}

// ========================================
// LOAD ADMIN PROMPTS
// ========================================
let allPrompts = []; // Cache all prompts for local search

async function loadAdminPrompts() {
    const grid = document.getElementById('adminGrid');

    try {
        const { data, error } = await supabaseClient
            .from('prompts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Cache prompts for local search
        allPrompts = data || [];

        if (data && data.length > 0) {
            const fragment = document.createDocumentFragment();
            data.forEach((prompt) => {
                fragment.appendChild(renderAdminCard(prompt));
            });
            grid.replaceChildren(fragment);
        } else {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-dim);">No prompts yet. Create your first one!</p>';
        }

        // Setup search after data is loaded
        setupAdminSearch();
    } catch (err) {
        console.error('Error loading prompts:', err);
        showToast('Failed to load prompts', 'error');
    }
}

// ========================================
// RENDER ADMIN CARD
// ========================================
function renderAdminCard(prompt) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.dataset.id = String(prompt.id ?? '');

    const checkbox = document.createElement('span');
    checkbox.className = 'select-checkbox';
    checkbox.innerHTML = '<i class="fas fa-check"></i>';
    card.appendChild(checkbox);

    const image = document.createElement('img');
    image.className = 'admin-card-image';
    image.alt = prompt.title || 'Prompt cover';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';

    const imageUrl = sanitizeImageUrl(Array.isArray(prompt.images) ? prompt.images[0] : '');
    if (imageUrl) {
        image.src = imageUrl;
    } else {
        image.removeAttribute('src');
    }
    card.appendChild(image);

    const content = document.createElement('div');
    content.className = 'admin-card-content';
    const title = document.createElement('div');
    title.className = 'admin-card-title';
    title.textContent = prompt.title || 'Untitled Prompt';
    content.appendChild(title);
    card.appendChild(content);

    const hoverLeft = document.createElement('div');
    hoverLeft.className = 'admin-card-hover-actions left';
    const hoverEdit = document.createElement('button');
    hoverEdit.className = 'hover-action-btn edit';
    hoverEdit.type = 'button';
    hoverEdit.title = '编辑';
    hoverEdit.innerHTML = '<i class="fas fa-edit"></i>';
    hoverEdit.addEventListener('click', (event) => {
        event.stopPropagation();
        editPrompt(prompt.id);
    });
    hoverLeft.appendChild(hoverEdit);
    card.appendChild(hoverLeft);

    const hoverRight = document.createElement('div');
    hoverRight.className = 'admin-card-hover-actions right';

    const hoverDelete = document.createElement('button');
    hoverDelete.className = 'hover-action-btn delete';
    hoverDelete.type = 'button';
    hoverDelete.title = '删除';
    hoverDelete.innerHTML = '<i class="fas fa-trash"></i>';
    hoverDelete.addEventListener('click', (event) => {
        event.stopPropagation();
        deletePrompt(prompt.id);
    });

    const hoverJump = document.createElement('button');
    hoverJump.className = 'hover-action-btn jump';
    hoverJump.type = 'button';
    hoverJump.title = '在画廊查看';
    hoverJump.innerHTML = '<i class="fas fa-external-link-alt"></i>';
    hoverJump.addEventListener('click', (event) => {
        event.stopPropagation();
        const promptTarget = encodeURIComponent(String(prompt.supabaseId || prompt.id || ''));
        window.open(`prompts.html?id=${promptTarget}`, '_blank', 'noopener');
    });

    hoverRight.appendChild(hoverDelete);
    hoverRight.appendChild(hoverJump);
    card.appendChild(hoverRight);

    const actions = document.createElement('div');
    actions.className = 'admin-card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'admin-action-btn';
    editBtn.type = 'button';
    editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
    editBtn.addEventListener('click', () => editPrompt(prompt.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'admin-action-btn delete';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
    deleteBtn.addEventListener('click', () => deletePrompt(prompt.id));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);

    return card;
}

// ========================================
// EDIT PROMPT
// ========================================
async function editPrompt(id) {
    try {
        const { data, error } = await supabaseClient
            .from('prompts')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Switch to create view
        switchView('create');

        // Set mode to edit
        currentMode = 'edit';
        editingId = id;

        // Show the form (it's hidden by default)
        const promptForm = document.getElementById('promptForm');
        promptForm.style.display = 'flex';

        // Populate form fields
        document.getElementById('promptTitle').value = data.title || '';
        setCustomDropdownValue('categoryDropdown', data.tags?.[0] || '');
        document.getElementById('promptText').value = data.prompt_text || '';

        // Show last edited time (compact version)
        const lastEditedInfo = document.getElementById('lastEditedInfo');
        const lastEditedTime = document.getElementById('lastEditedTime');
        if (data.updated_at) {
            const date = new Date(data.updated_at);
            const formatted = date.toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            lastEditedTime.textContent = formatted;
            lastEditedInfo.style.display = 'inline-flex';
        } else if (data.created_at) {
            // Fallback to created_at if no updated_at
            const date = new Date(data.created_at);
            const formatted = date.toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            lastEditedTime.textContent = formatted + ' (创建)';
            lastEditedInfo.style.display = 'inline-flex';
        } else {
            lastEditedInfo.style.display = 'none';
        }

        // Update button
        const saveBtn = document.getElementById('saveBtn');
        const btnText = saveBtn.querySelector('.btn-text');
        btnText.innerHTML = '<i class="fas fa-save"></i> Update Prompt';

        // Show cancel button if not exists
        let cancelBtn = document.getElementById('cancelEditBtn');
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelEditBtn';
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn-secondary';
            cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
            cancelBtn.onclick = cancelEdit;
            saveBtn.parentElement.insertBefore(cancelBtn, saveBtn);
        }

        // Load images into preview AND into uploadedFiles for analysis
        if (data.images && data.images.length > 0) {
            const previewGrid = document.getElementById('previewGrid');
            previewGrid.innerHTML = data.images.map((url, idx) => `
                <div class="preview-item">
                    <img src="${url}" alt="Preview ${idx + 1}">
                </div>
            `).join('');
            previewGrid.style.display = 'grid';

            // Clear and load images into uploadedFiles for analysis capability
            uploadedFiles = [];

            // Fetch and convert images to base64 for AI analysis
            for (const imageUrl of data.images) {
                try {
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    const reader = new FileReader();

                    await new Promise((resolve, reject) => {
                        reader.onload = () => {
                            uploadedFiles.push({
                                file: null,
                                dataUrl: reader.result,
                                base64: reader.result.split(',')[1],
                                url: imageUrl  // Store original URL to reuse in uploadImages
                            });
                            resolve();
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch (err) {
                    console.warn('Failed to load image for analysis:', imageUrl, err);
                }
            }

            // Enable analyze button since we have images
            const analyzeBtn = document.getElementById('analyzeBtn');
            if (analyzeBtn) {
                analyzeBtn.disabled = uploadedFiles.length === 0 || !window.AdminAI?.configured;
            }
        }

        // Scroll to form
        setTimeout(() => {
            promptForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

    } catch (err) {
        console.error('Error loading prompt for edit:', err);
        showToast('Failed to load prompt', 'error');
    }
}

// ========================================
// CANCEL EDIT
// ========================================
function cancelEdit() {
    currentMode = 'create';
    editingId = null;

    // Reset form
    resetForm();

    // Update button
    const saveBtn = document.getElementById('saveBtn');
    const btnText = saveBtn.querySelector('.btn-text');
    btnText.innerHTML = '<i class="fas fa-save"></i> Save to Gallery';

    // Remove cancel button
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) cancelBtn.remove();
}

// ========================================
// DELETE PROMPT
// ========================================
async function deletePrompt(id) {
    if (!confirm('Delete this prompt? This action cannot be undone.')) {
        return;
    }

    console.log('Attempting to delete prompt with ID:', id);

    try {
        const { error } = await supabaseClient
            .from('prompts')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Supabase delete error:', error);
            throw error;
        }

        console.log('Successfully deleted from database');
        await auditPromptAction('prompt.delete', { prompt_id: id });

        // Remove from UI with animation
        const card = document.querySelector(`[data-id="${id}"]`);
        if (card) {
            card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => {
                card.remove();
                // Update count after removal
                const countEl = document.getElementById('promptCount');
                const currentCount = parseInt(countEl.textContent);
                const newCount = Math.max(0, currentCount - 1);
                countEl.textContent = newCount;

                // If no prompts left, show empty message
                if (newCount === 0) {
                    const grid = document.getElementById('adminGrid');
                    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-dim);">No prompts yet. Create your first one!</p>';
                }
            }, 300);
        }

        showToast('Prompt deleted successfully!', 'success');
    } catch (err) {
        console.error('Delete operation failed:', err);
        showToast(`Delete failed: ${err.message || 'Unknown error'}`, 'error');
    }
}

// ========================================

async function checkApiKey() {
    try {
        if (!window.AdminAI) {
            throw new Error('AdminAI client not loaded');
        }

        const payload = await window.AdminAI.checkHealth(true);
        window.GEMINI_API_KEY = payload.configured ? '__server_proxy__' : '';
        window.GEMINI_API_SOURCE = payload.source || (payload.configured ? 'environment' : 'missing');

        if (payload.configured) {
            updateStatus('AI Proxy Ready', 'ready');
        } else {
            updateStatus('AI Proxy Missing', 'error');
        }
    } catch (err) {
        console.warn('Failed to verify AI proxy:', err);
        window.GEMINI_API_KEY = '';
        window.GEMINI_API_SOURCE = 'missing';
        updateStatus('AI Proxy Missing', 'error');
    } finally {
        renderApiKeySelector();
        updateAnalyzeButton();
    }
}

function getApiKeys() {
    if (!window.GEMINI_API_KEY) return [];
    return [{
        name: 'Server Proxy',
        key: '__server_proxy__',
        source: window.GEMINI_API_SOURCE || 'missing'
    }];
}

function getActiveKeyIndex() {
    return 0;
}

function saveApiKeys() {
    return true;
}

function getGeminiSourceMeta() {
    const source = window.GEMINI_API_SOURCE || 'missing';

    if (source === 'stored') {
        return {
            source,
            title: '后台安全存储',
            preview: '由服务端加密保存，可在后台更新或删除',
            badge: '后台托管',
            statusText: 'Gemini Key 已由后台安全存储'
        };
    }

    if (source === 'environment') {
        return {
            source,
            title: 'Vercel 环境变量',
            preview: '当前由 Vercel 环境变量托管，录入后将优先使用后台安全存储',
            badge: '环境变量',
            statusText: 'Gemini Key 当前由环境变量托管'
        };
    }

    return {
        source: 'missing',
        title: '未配置',
        preview: '暂未配置 Gemini Key，可在此录入后提交到服务端安全存储',
        badge: '待配置',
        statusText: '未配置 Gemini Key'
    };
}

async function getAdminApiHeaders() {
    if (!window.AdminAI?.getAuthHeaders) {
        throw new Error('AdminAI client not loaded');
    }

    return window.AdminAI.getAuthHeaders();
}

async function saveServerManagedGeminiKey(apiKey) {
    const headers = await getAdminApiHeaders();
    const response = await fetch('/api/admin/settings/gemini-key', {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || '保存 Gemini Key 失败');
    }

    return payload;
}

async function deleteServerManagedGeminiKey() {
    const headers = await getAdminApiHeaders();
    const response = await fetch('/api/admin/settings/gemini-key', {
        method: 'DELETE',
        headers
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || '删除 Gemini Key 失败');
    }

    return payload;
}

async function promptForApiKey() {
    const meta = getGeminiSourceMeta();
    const helperText = meta.source === 'stored'
        ? '输入新的 Gemini API Key 将覆盖当前后台安全存储的 Key。'
        : (meta.source === 'environment'
            ? '当前使用的是 Vercel 环境变量。输入新的 Gemini API Key 后，将优先使用后台安全存储版本。'
            : '请输入 Gemini API Key，提交后会由服务端加密保存。');

    const input = window.prompt(`${helperText}\n\n请输入 Gemini API Key：`, '');
    if (input === null) return;

    const apiKey = String(input || '').trim();
    if (!apiKey) {
        showToast('未输入 Gemini API Key', 'warning');
        return;
    }

    try {
        showToast('正在安全保存 Gemini Key...', 'info');
        const payload = await saveServerManagedGeminiKey(apiKey);
        window.GEMINI_API_KEY = payload.configured ? '__server_proxy__' : '';
        window.GEMINI_API_SOURCE = payload.source || 'stored';
        window.AdminAI.configured = Boolean(payload.configured);
        window.AdminAI.source = window.GEMINI_API_SOURCE;
        renderApiKeySelector();
        updateAnalyzeButton();
        showToast(payload.message || 'Gemini Key 已安全保存到服务端。', 'success');
    } catch (err) {
        console.error('Failed to save Gemini key:', err);
        showToast(err.message || '保存 Gemini Key 失败', 'error');
    }
}

function switchApiKey() {
    showToast('当前始终优先使用后台安全存储，其次才是 Vercel 环境变量。', 'info');
}

function addNewApiKey() {
    promptForApiKey();
}

window.addNewApiKey = addNewApiKey;

async function deleteApiKey() {
    if ((window.GEMINI_API_SOURCE || 'missing') !== 'stored') {
        showToast('当前没有可删除的后台存储 Gemini Key。', 'info');
        return;
    }

    if (!confirm('确定要删除当前后台安全存储的 Gemini Key 吗？')) {
        return;
    }

    try {
        const payload = await deleteServerManagedGeminiKey();
        window.GEMINI_API_KEY = payload.configured ? '__server_proxy__' : '';
        window.GEMINI_API_SOURCE = payload.source || 'missing';
        window.AdminAI.configured = Boolean(payload.configured);
        window.AdminAI.source = window.GEMINI_API_SOURCE;
        renderApiKeySelector();
        updateAnalyzeButton();
        showToast(payload.message || 'Gemini Key 已删除', 'success');
    } catch (err) {
        console.error('Failed to delete Gemini key:', err);
        showToast(err.message || '删除 Gemini Key 失败', 'error');
    }
}

function renderApiKeySelector() {
    const container = document.getElementById('apiKeySelector');
    const settingsList = document.getElementById('settingsApiKeysList');
    const isReady = Boolean(window.GEMINI_API_KEY);
    const meta = getGeminiSourceMeta();

    // Render header dropdown (simplified)
    if (container) {
        container.innerHTML = `
            <div class="api-key-dropdown">
                <button class="api-key-current" type="button" data-admin-action="settings-prompt-api-key">
                    <i class="fas fa-shield-alt"></i>
                    <span>${isReady ? `Server Proxy · ${meta.title}` : 'AI Proxy 未配置'}</span>
                </button>
            </div>
        `;
    }

    // Render settings page key list (full version)
    if (settingsList) {
        settingsList.innerHTML = `
            <div class="api-key-row active" data-index="0">
                <div class="key-info" data-admin-action="settings-prompt-api-key">
                    <span class="key-name-label">Server Proxy</span>
                    <span class="key-preview-label">${meta.preview}</span>
                </div>
                <div class="key-actions" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="key-active-badge">${isReady ? meta.badge : '待配置'}</span>
                    <button class="btn-add-config" type="button" data-admin-action="settings-prompt-api-key" style="margin-top: 0; padding: 8px 12px;">
                        ${isReady ? '更新 Key' : '录入 Key'}
                    </button>
                    ${meta.source === 'stored' ? `
                        <button class="btn-add-config" type="button" data-admin-action="settings-delete-api-key" style="margin-top: 0; padding: 8px 12px; border-color: rgba(248, 113, 113, 0.35); color: #fecaca;">
                            删除 Key
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // Update API status in settings page
    const apiStatus = document.getElementById('apiKeyStatus');
    if (apiStatus) {
        const dot = apiStatus.querySelector('.status-dot');
        const text = apiStatus.querySelector('span:last-child');

        if (isReady) {
            dot.className = 'status-dot ready';
            text.textContent = meta.statusText;
        } else {
            dot.className = 'status-dot error';
            text.textContent = '未配置 Gemini Key';
        }
    }
}

// Edit API key name
function editApiKeyName() {
    showToast('当前仅支持一个 Gemini 服务端代理密钥。', 'info');
}


function toggleApiKeyDropdown() {
    promptForApiKey();
}

window.addNewApiKey = addNewApiKey;
window.promptForApiKey = promptForApiKey;
window.deleteApiKey = deleteApiKey;

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.api-key-dropdown')) {
        const menu = document.getElementById('apiKeyMenu');
        if (menu) menu.classList.remove('show');
    }
    // Also close custom dropdowns
    if (!e.target.closest('.custom-select')) {
        document.querySelectorAll('.custom-select.open').forEach(d => d.classList.remove('open'));
    }
});

// ========================================
// CUSTOM DROPDOWN
// ========================================
function initCustomDropdown() {
    // Initialize all custom dropdowns on the page
    document.querySelectorAll('.custom-select').forEach(dropdown => {
        setupCustomDropdown(dropdown);
    });
}

function setupCustomDropdown(dropdown, onChange) {
    const display = dropdown.querySelector('.select-display');
    const options = dropdown.querySelectorAll('.select-option');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');

    if (!display || !hiddenInput) return;

    // Toggle dropdown
    display.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other dropdowns
        document.querySelectorAll('.custom-select.open').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    });

    // Handle option selection
    options.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.textContent;
            const oldValue = hiddenInput.value;

            // Update hidden input
            hiddenInput.value = value;

            // Update display text
            displayText.textContent = text;

            // Update selected state
            options.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');

            // Close dropdown
            dropdown.classList.remove('open');

            // Trigger change event for filters
            if (oldValue !== value) {
                hiddenInput.dispatchEvent(new Event('change'));
            }
        });
    });

    // Keyboard navigation
    display.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dropdown.classList.toggle('open');
        } else if (e.key === 'Escape') {
            dropdown.classList.remove('open');
        }
    });

    display.setAttribute('tabindex', '0');
}

// Set custom dropdown value programmatically
function setCustomDropdownValue(dropdownId, value) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');
    const options = dropdown.querySelectorAll('.select-option');

    hiddenInput.value = value;

    options.forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.value === value) {
            displayText.textContent = option.textContent;
            if (value) {
                option.classList.add('selected');
            }
        }
    });
}

// ========================================
// WEBP CONVERSION
// ========================================

/**
 * Convert image to WebP format and optionally resize for optimal file size
 * @param {string} dataUrl - Original image data URL
 * @param {number} quality - WebP quality (0-1, default 0.85)
 * @param {number} maxWidth - Maximum width in pixels (default 1200, set to null to skip resize)
 * @returns {Promise<{dataUrl: string, base64: string}>}
 */
async function convertToWebP(dataUrl, quality = 0.85, maxWidth = 1200) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');

            // Calculate optimal dimensions
            let width = img.width;
            let height = img.height;

            // Resize if maxWidth is specified and image is larger
            if (maxWidth && width > maxWidth) {
                const aspectRatio = height / width;
                width = maxWidth;
                height = Math.round(maxWidth * aspectRatio);
                console.log(`📐 Resizing image from ${img.width}x${img.height} to ${width}x${height}`);
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Draw resized image
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to WebP
            const webpDataUrl = canvas.toDataURL('image/webp', quality);

            // Calculate file size reduction
            const originalSize = (dataUrl.length * 0.75 / 1024).toFixed(1); // Rough KB estimate
            const webpSize = (webpDataUrl.length * 0.75 / 1024).toFixed(1);
            const savings = ((1 - webpSize / originalSize) * 100).toFixed(0);

            console.log(`✅ WebP conversion: ${originalSize}KB → ${webpSize}KB (${savings}% smaller)`);

            resolve({
                dataUrl: webpDataUrl,
                base64: webpDataUrl.split(',')[1]
            });
        };
        img.onerror = () => reject(new Error('Failed to load image for WebP conversion'));
        img.src = dataUrl;
    });
}

// ========================================
// IMAGE GRID COMPOSITION (for multi-image analysis)
// ========================================

/**
 * Creates a grid image from multiple images for unified AI analysis.
 * Supports up to 6 images with adaptive layouts.
 * @param {Array} images - Array of image objects with dataUrl property
 * @returns {Promise<{dataUrl: string, base64: string}>} - Grid image as WebP
 */
async function createImageGrid(images) {
    if (images.length === 0) return null;
    if (images.length === 1) {
        // Single image - return as-is
        return { dataUrl: images[0].dataUrl, base64: images[0].base64 };
    }

    return new Promise((resolve, reject) => {
        // Max 6 images for 2x3 grid
        const gridImages = images.slice(0, 6);

        // Determine grid layout based on image count
        // 2 images: 1x2, 3-4 images: 2x2, 5-6 images: 2x3
        let cols, rows;
        if (gridImages.length <= 2) {
            cols = gridImages.length;
            rows = 1;
        } else if (gridImages.length <= 4) {
            cols = 2;
            rows = 2;
        } else {
            cols = 2;
            rows = 3;
        }

        // Target size for each cell (maintaining reasonable resolution)
        const cellSize = 512;
        const canvasWidth = cellSize * cols;
        const canvasHeight = cellSize * rows;

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');

        // Fill with neutral gray background
        ctx.fillStyle = '#404040';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        let loadedCount = 0;
        const imageElements = [];

        gridImages.forEach((imgData, index) => {
            const img = new Image();
            img.onload = () => {
                imageElements[index] = img;
                loadedCount++;

                if (loadedCount === gridImages.length) {
                    // All images loaded, draw grid
                    imageElements.forEach((imgEl, i) => {
                        // Calculate position based on cols
                        const x = (i % cols) * cellSize;
                        const y = Math.floor(i / cols) * cellSize;

                        // Draw image centered in cell with cover behavior
                        const scale = Math.max(cellSize / imgEl.width, cellSize / imgEl.height);
                        const scaledWidth = imgEl.width * scale;
                        const scaledHeight = imgEl.height * scale;
                        const offsetX = (cellSize - scaledWidth) / 2;
                        const offsetY = (cellSize - scaledHeight) / 2;

                        ctx.drawImage(imgEl, x + offsetX, y + offsetY, scaledWidth, scaledHeight);
                    });

                    // Convert to WebP
                    const webpDataUrl = canvas.toDataURL('image/webp', 0.85);
                    resolve({
                        dataUrl: webpDataUrl,
                        base64: webpDataUrl.split(',')[1]
                    });
                }
            };
            img.onerror = () => reject(new Error('Failed to load image for grid'));
            img.src = imgData.dataUrl;
        });
    });
}

// ========================================
// UPLOAD ZONE
// ========================================
function initUploadZone() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    // Click to upload
    uploadZone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // Drag and drop
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

async function handleFiles(files) {
    const validFiles = Array.from(files).filter(file =>
        file.type.startsWith('image/')
    );

    if (validFiles.length === 0) {
        showToast('请上传图片文件', 'error');
        return;
    }

    for (const file of validFiles) {
        const reader = new FileReader();

        await new Promise((resolve) => {
            reader.onload = async (e) => {
                try {
                    // Convert to WebP automatically
                    const webp = await convertToWebP(e.target.result);

                    uploadedFiles.push({
                        file: file,               // Keep original file reference
                        dataUrl: webp.dataUrl,    // Use WebP for display
                        base64: webp.base64,      // Use WebP for upload
                        originalDataUrl: e.target.result  // Preserve original
                    });

                    console.log(`✅ Converted ${file.name} to WebP`);
                } catch (err) {
                    console.warn('WebP conversion failed, using original:', err);
                    // Fallback to original if WebP conversion fails
                    uploadedFiles.push({
                        file: file,
                        dataUrl: e.target.result,
                        base64: e.target.result.split(',')[1]
                    });
                }

                renderPreviews();
                updateAnalyzeButton();
                resolve();
            };
            reader.readAsDataURL(file);
        });
    }
}

function renderPreviews() {
    const grid = document.getElementById('previewGrid');
    grid.innerHTML = uploadedFiles.map((item, index) => `
        <div class="preview-item" data-index="${index}">
            <img src="${item.dataUrl}" alt="Preview ${index + 1}">
            <button class="remove-btn" onclick="removeFile(${index})">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderPreviews();
    updateAnalyzeButton();
}

function updateAnalyzeButton() {
    const btn = document.getElementById('analyzeBtn');
    btn.disabled = uploadedFiles.length === 0 || !window.AdminAI?.configured;
}

// ========================================
// GEMINI AI ANALYSIS
// ========================================
document.getElementById('analyzeBtn').addEventListener('click', analyzeImages);

async function analyzeImages() {
    if (uploadedFiles.length === 0) return;

    if (!window.AdminAI?.configured) {
        showToast('请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key', 'error');
        await checkApiKey();
        return;
    }

    const loadingEl = document.getElementById('analysisLoading');
    const formEl = document.getElementById('promptForm');
    const btn = document.getElementById('analyzeBtn');

    // Show loading
    loadingEl.style.display = 'flex';
    formEl.style.display = 'none';
    btn.disabled = true;
    updateStatus('Analyzing...', 'processing');

    try {
        // Create grid image from all uploaded images (max 6)
        const gridImage = await createImageGrid(uploadedFiles);

        if (!gridImage) {
            throw new Error('无法处理图片');
        }

        // Log grid info
        const imageCount = Math.min(uploadedFiles.length, 6);
        console.log(`🖼️ Analyzing ${imageCount} image(s) as ${imageCount > 1 ? 'grid' : 'single'}`);

        const result = await callGeminiVision(gridImage.base64);

        analysisResult = result;
        populateForm(result);

        loadingEl.style.display = 'none';
        formEl.style.display = 'flex';
        updateStatus('Analysis Complete', 'ready');
        showToast(`AI 分析完成！(${imageCount} 张图片)`, 'success');

    } catch (error) {
        console.error('Analysis error:', error);
        loadingEl.style.display = 'none';
        updateStatus('Error', 'error');
        showToast(`分析失败: ${error.message}`, 'error');
    }

    btn.disabled = false;
}

async function callGeminiVision(imageBase64) {
    const analysisPrompt = `Analyze this AI-generated art image and return a JSON object with the following structure. Be creative and descriptive.

{
    "title": "A creative, descriptive title in English (2-5 words)",
    "title_en": "Same as title - the English version of the title",
    "title_zh": "创意标题的中文版本",
    "category": "One of: Photography, Illustration, 3D Art, Miniature, Creative, Animation",
    "description": "A brief 1-2 sentence description of the image in English",
    "description_en": "Same as description - English version",
    "description_zh": "描述的中文版本",
    "prompt_suggestion_en": "A suggested prompt in English that could recreate this image style (2-4 sentences)",
    "prompt_suggestion_zh": "一个建议的中文提示词，可以重现这种图像风格（2-4句话）",
    "objects": {
        "en": ["5-8 objects or subjects visible in the image"],
        "zh": ["对应的中文翻译"]
    },
    "scenes": {
        "en": ["3-5 scene or environment descriptors"],
        "zh": ["对应的中文翻译"]
    },
    "styles": {
        "en": ["5-7 art style descriptors"],
        "zh": ["对应的中文翻译"]
    },
    "mood": {
        "en": ["5-7 mood or atmosphere words"],
        "zh": ["对应的中文翻译"]
    },
    "dominantColors": ["3-5 color names in English, e.g., 'blue', 'golden', 'dark gray'"],
    "useCase": {
        "platform": ["Best 2-3 platforms: 小红书封面, 抖音头图, 公众号配图, Instagram帖子, 淘宝主图, 手机壁纸, 头像, 海报"],
        "purpose": ["Best 1-2 purposes: 电商卖货, 品牌营销, 个人IP, 知识付费, 虚拟产品, 自媒体配图, 表情包"],
        "format": ["Recommended 1-2 formats: 9:16竖版, 1:1方图, 16:9横版, 3:4小红书, 手机壁纸尺寸"]
    },
    "commercial": {
        "niche": ["Best 1-3 niches: 母婴, 美妆, 健身, 美食, 旅游, 教育, 宠物, 家居, 时尚, 科技, 游戏, 情感"],
        "targetAudience": ["Target 1-2 audiences: Z世代, 职场女性, 新手妈妈, 中产家庭, 学生党, 二次元, 文艺青年"]
    },
    "difficulty": "One of: 新手友好, 进阶, 专业级"
}

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks, no explanation.`;

    const response = await window.AdminAI.generate({
        model: GEMINI_MODEL,
        contents: [{
            parts: [
                { text: analysisPrompt },
                {
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: imageBase64
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096
        }
    });

    const text = window.AdminAI.extractText(response);

    if (!text) {
        throw new Error('No response from Gemini');
    }

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('JSON parse error:', jsonStr);
        throw new Error('Failed to parse AI response');
    }
}

// ========================================
// FORM HANDLING
// ========================================
function initForm() {
    document.getElementById('promptForm').addEventListener('submit', savePrompt);
}

function populateForm(data) {
    // Title
    document.getElementById('promptTitle').value = data.title || '';

    // Category
    if (data.category) {
        setCustomDropdownValue('categoryDropdown', data.category);
    }

    // Description
    document.getElementById('promptDescription').value = data.description || '';

    // Tags
    renderTags('tagObjects', data.objects);
    renderTags('tagScenes', data.scenes);
    renderTags('tagStyles', data.styles);
    renderTags('tagMood', data.mood);

    // Colors
    renderColors(data.dominantColors || []);
}

function renderTags(containerId, tagData) {
    const container = document.getElementById(containerId);
    if (!tagData || !tagData.en) {
        container.innerHTML = '<span style="color: var(--text-dim)">No tags</span>';
        return;
    }

    container.innerHTML = tagData.en.map((tag, i) => {
        const zhTag = tagData.zh?.[i] || '';
        return `
            <span class="tag-item">
                ${tag}
                ${zhTag ? `<span class="tag-zh">(${zhTag})</span>` : ''}
            </span>
        `;
    }).join('');
}

function renderColors(colors) {
    const container = document.getElementById('colorSwatches');

    // Color name to hex mapping
    const colorMap = {
        'white': '#ffffff', 'black': '#000000', 'gray': '#808080', 'grey': '#808080',
        'red': '#e74c3c', 'blue': '#3498db', 'green': '#2ecc71', 'yellow': '#f1c40f',
        'orange': '#e67e22', 'purple': '#9b59b6', 'pink': '#e91e63', 'brown': '#8b4513',
        'gold': '#ffd700', 'golden': '#ffd700', 'silver': '#c0c0c0', 'bronze': '#cd7f32',
        'cyan': '#00bcd4', 'teal': '#008080', 'navy': '#001f3f', 'maroon': '#800000',
        'beige': '#f5f5dc', 'cream': '#fffdd0', 'ivory': '#fffff0', 'tan': '#d2b48c',
        'coral': '#ff7f50', 'salmon': '#fa8072', 'turquoise': '#40e0d0', 'lavender': '#e6e6fa',
        'dark blue': '#00008b', 'dark green': '#006400', 'dark gray': '#404040', 'dark grey': '#404040',
        'light blue': '#add8e6', 'light green': '#90ee90', 'light gray': '#d3d3d3', 'light grey': '#d3d3d3'
    };

    container.innerHTML = colors.map(color => {
        const hex = colorMap[color.toLowerCase()] || '#888888';
        return `<div class="color-swatch" style="background: ${hex}" data-color="${color}"></div>`;
    }).join('');
}

async function savePrompt(e) {
    e.preventDefault();

    // For new prompts, require AI analysis. For editing, just need images.
    if (currentMode === 'create') {
        if (!analysisResult || uploadedFiles.length === 0) {
            showToast('请先上传图片并进行 AI 分析', 'error');
            return;
        }
    } else if (currentMode === 'edit') {
        // When editing, we don't need new analysis - just images
        if (uploadedFiles.length === 0) {
            showToast('请确保有图片', 'error');
            return;
        }
    }

    const saveBtn = document.getElementById('saveBtn');
    const dotMatrix = document.getElementById('dotMatrix');

    // Initialize dot matrix
    initDotMatrix();

    // Start saving animation
    saveBtn.classList.add('saving');
    saveBtn.disabled = true;
    updateStatus('Saving...', 'processing');

    // Start progress animation
    let progress = 0;
    const progressInterval = setInterval(() => {
        if (progress < 24) { // Leave last 6 dots for completion
            progress++;
            updateDotProgress(progress);
        }
    }, 80);

    try {
        // Get form values
        const title = document.getElementById('promptTitle').value.trim();
        const category = document.getElementById('promptCategory').value;
        const promptText = document.getElementById('promptText').value.trim();
        const description = document.getElementById('promptDescription').value.trim();

        if (!title || !category) {
            throw new Error('请填写标题和分类');
        }

        // Try to upload images to Supabase Storage
        let imageUrls = [];
        let storageAvailable = true;

        try {
            imageUrls = await uploadImages();
            progress = Math.min(progress + 3, 27);
            updateDotProgress(progress);
        } catch (storageError) {
            console.warn('Storage upload failed:', storageError);
            storageAvailable = false;
            // Keep existing images when storage fails in edit mode
            imageUrls = [];
        }

        // Create prompt object
        // In edit mode without new analysis, preserve existing values by not including them
        const promptData = {
            title: title,
            tags: [category],
            description: description,
            prompt: promptText,
            images: imageUrls,
        };

        // Only include AI analysis data if we have it (new analysis was run)
        if (analysisResult) {
            promptData.dominantColors = analysisResult.dominantColors || [];
            promptData.aiTags = {
                objects: analysisResult.objects,
                scenes: analysisResult.scenes,
                styles: analysisResult.styles,
                mood: analysisResult.mood
            };
            // Bilingual fields from AI analysis
            promptData.title_en = analysisResult.title_en || analysisResult.title || title;
            promptData.title_zh = analysisResult.title_zh || '';
            promptData.description_en = analysisResult.description_en || analysisResult.description || description;
            promptData.description_zh = analysisResult.description_zh || '';
            promptData.prompt_text_en = analysisResult.prompt_suggestion_en || '';
            promptData.prompt_text_zh = analysisResult.prompt_suggestion_zh || '';
        }

        // Auto-translate missing bilingual fields using PromptTranslator
        if (window.PromptTranslator && window.AdminAI?.configured) {
            try {
                // Show translation UI feedback
                updateStatus('Translating...', 'processing');
                const statusBtn = document.querySelector('.status-text');
                if (statusBtn) {
                    const originalText = statusBtn.textContent;
                    statusBtn.textContent = '🌐 翻译中...';
                    setTimeout(() => statusBtn.textContent = originalText, 3000);
                }

                // Translate title
                if (promptData.title) {
                    if (!promptData.title_zh?.trim() && !PromptTranslator.isChinese(promptData.title)) {
                        promptData.title_zh = await PromptTranslator.translateToChinese(promptData.title);
                    }
                    if (!promptData.title_en?.trim() && PromptTranslator.isChinese(promptData.title)) {
                        promptData.title_en = await PromptTranslator.translateToEnglish(promptData.title);
                    }
                }

                // Translate description
                if (promptData.description) {
                    if (!promptData.description_zh?.trim() && !PromptTranslator.isChinese(promptData.description)) {
                        promptData.description_zh = await PromptTranslator.translateToChinese(promptData.description);
                    }
                    if (!promptData.description_en?.trim() && PromptTranslator.isChinese(promptData.description)) {
                        promptData.description_en = await PromptTranslator.translateToEnglish(promptData.description);
                    }
                }

                // Translate prompt text
                if (promptData.prompt) {
                    if (!promptData.prompt_text_zh?.trim() && !PromptTranslator.isChinese(promptData.prompt)) {
                        promptData.prompt_text_zh = await PromptTranslator.translateToChinese(promptData.prompt);
                    }
                    if (!promptData.prompt_text_en?.trim() && PromptTranslator.isChinese(promptData.prompt)) {
                        promptData.prompt_text_en = await PromptTranslator.translateToEnglish(promptData.prompt);
                    }
                }


                console.log('[Gallery] Auto-translation complete:', {
                    title_zh: promptData.title_zh,
                    title_en: promptData.title_en,
                    description_zh: promptData.description_zh,
                    description_en: promptData.description_en
                });
                updateStatus('Saving...', 'processing');
            } catch (translateError) {
                console.warn('[Gallery] Translation failed, continuing without:', translateError);
                // Don't block save if translation fails
            }
        }

        // Always save to Supabase database (storage availability doesn't matter for DB save)
        try {
            let data, error;

            if (currentMode === 'edit' && editingId) {
                // UPDATE existing prompt - build update object
                const updateData = {
                    title: promptData.title,
                    tags: promptData.tags,
                    description: promptData.description,
                    prompt_text: promptData.prompt,
                };
                // Only update images if storage upload was successful
                if (storageAvailable) {
                    updateData.images = promptData.images;
                }
                // Only update AI-related fields if new analysis was done
                if (promptData.dominantColors) {
                    updateData.dominant_colors = promptData.dominantColors;
                }
                if (promptData.aiTags) {
                    updateData.ai_tags = promptData.aiTags;
                }
                // Include bilingual fields if available
                if (promptData.title_en) updateData.title_en = promptData.title_en;
                if (promptData.title_zh) updateData.title_zh = promptData.title_zh;
                if (promptData.description_en) updateData.description_en = promptData.description_en;
                if (promptData.description_zh) updateData.description_zh = promptData.description_zh;
                if (promptData.prompt_text_en) updateData.prompt_text_en = promptData.prompt_text_en;
                if (promptData.prompt_text_zh) updateData.prompt_text_zh = promptData.prompt_text_zh;

                ({ data, error } = await supabaseClient
                    .from('prompts')
                    .update(updateData)
                    .eq('id', editingId)
                    .select());

                if (!error) {
                    await auditPromptAction('prompt.update', {
                        prompt_id: editingId,
                        title: updateData.title,
                        tags: updateData.tags || []
                    });
                }
            } else {
                // INSERT new prompt
                ({ data, error } = await supabaseClient
                    .from('prompts')
                    .insert([{
                        title: promptData.title,
                        tags: promptData.tags,
                        description: promptData.description,
                        prompt_text: promptData.prompt,
                        images: promptData.images,
                        dominant_colors: promptData.dominantColors,
                        ai_tags: promptData.aiTags,
                        // Bilingual fields
                        title_en: promptData.title_en,
                        title_zh: promptData.title_zh,
                        description_en: promptData.description_en,
                        description_zh: promptData.description_zh,
                        prompt_text_en: promptData.prompt_text_en,
                        prompt_text_zh: promptData.prompt_text_zh
                    }])
                    .select());

                if (!error) {
                    await auditPromptAction('prompt.create', {
                        prompt_id: data?.[0]?.id || null,
                        title: promptData.title,
                        tags: promptData.tags || []
                    });
                }
            }

            if (error) throw error;

            const successMsg = currentMode === 'edit' ? 'Prompt updated!' : 'Prompt saved!';
            showToast(successMsg, 'success');

            // Reset edit mode
            if (currentMode === 'edit') {
                cancelEdit();
            }
        } catch (dbError) {
            console.warn('Database save failed:', dbError);
            showToast('数据库保存失败，已生成代码片段', 'info');
        }

        // Complete the progress
        clearInterval(progressInterval);
        completeDotProgress();

        // Success state
        setTimeout(() => {
            saveBtn.classList.remove('saving');
            saveBtn.classList.add('saved');
            saveBtn.querySelector('.btn-text').innerHTML = '<i class="fas fa-check"></i> Saved!';
            updateStatus('Saved', 'ready');
            showToast('Prompt 已保存到数据库！', 'success');

            // Reset button after delay
            setTimeout(() => {
                saveBtn.classList.remove('saved');
                saveBtn.querySelector('.btn-text').innerHTML = '<i class="fas fa-save"></i> Save to Gallery';
                saveBtn.disabled = false;
            }, 2000);
        }, 400);

        // Always generate code for prompts-data.js
        generateCodeSnippet(promptData);

    } catch (error) {
        clearInterval(progressInterval);
        console.error('Save error:', error);
        showToast(`保存失败: ${error.message}`, 'error');
        updateStatus('Error', 'error');

        // Reset button
        saveBtn.classList.remove('saving');
        saveBtn.disabled = false;
    }
}

// ========================================
// DOT MATRIX ANIMATION
// ========================================
function initDotMatrix() {
    const dotMatrix = document.getElementById('dotMatrix');
    dotMatrix.innerHTML = '';

    // Create 30 dots (10 columns x 3 rows)
    for (let i = 0; i < 30; i++) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.dataset.index = i;
        dotMatrix.appendChild(dot);
    }
}

function updateDotProgress(count) {
    const dots = document.querySelectorAll('.dot-matrix .dot');
    dots.forEach((dot, index) => {
        if (index < count) {
            dot.classList.add('active');
            dot.classList.remove('complete');
        }
    });
}

function completeDotProgress() {
    const dots = document.querySelectorAll('.dot-matrix .dot');
    dots.forEach((dot, index) => {
        setTimeout(() => {
            dot.classList.remove('active');
            dot.classList.add('complete');
        }, index * 15);
    });
}

/**
 * Generate a thumbnail from base64 image using Canvas API
 * @param {string} base64 - Original image base64 (without data: prefix)
 * @param {number} maxWidth - Maximum width for thumbnail (default: 400)
 * @param {number} quality - WebP quality 0-1 (default: 0.8)
 * @returns {Promise<string>} - Thumbnail base64 (without data: prefix)
 */
async function generateThumbnail(base64, maxWidth = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            // Only resize if image is wider than maxWidth
            if (img.width <= maxWidth) {
                resolve(base64); // Return original if already small
                return;
            }

            const canvas = document.createElement('canvas');
            const ratio = maxWidth / img.width;
            canvas.width = maxWidth;
            canvas.height = Math.round(img.height * ratio);

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Convert to WebP base64
            const thumbnailDataUrl = canvas.toDataURL('image/webp', quality);
            const thumbnailBase64 = thumbnailDataUrl.split(',')[1];
            resolve(thumbnailBase64);
        };
        img.onerror = () => reject(new Error('Failed to load image for thumbnail generation'));
        img.src = `data:image/webp;base64,${base64}`;
    });
}

async function uploadImages() {
    const urls = [];
    const imagesToUpload = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
        const item = uploadedFiles[i];

        // If item already has a public URL (existing image in edit mode), just use it
        if (item.url && item.url.startsWith('http')) {
            urls.push(item.url);
            console.log(`♻️ Reusing existing URL: ${item.url.substring(0, 50)}...`);
            continue;
        }

        // Get base64 data
        const base64 = item.base64;
        if (!base64) {
            console.warn(`⚠️ No base64 data for image ${i}, skipping`);
            continue;
        }

        // Generate filename (WebP format)
        const baseName = item.file?.name?.replace(/\.[^.]+$/, '') || 'image';
        const fileName = `${Date.now()}_${i}_${baseName.replace(/[^a-zA-Z0-9]/g, '_')}.webp`;

        // Add original image
        imagesToUpload.push({
            base64: base64,
            filename: fileName,
            isThumb: false
        });

        // Generate and add thumbnail
        try {
            const thumbBase64 = await generateThumbnail(base64, 800, 0.85);
            imagesToUpload.push({
                base64: thumbBase64,
                filename: fileName, // Same filename, Edge Function will add thumb/ prefix
                isThumb: true
            });
            console.log(`🖼️ Generated thumbnail for: ${fileName}`);
        } catch (thumbError) {
            console.warn(`⚠️ Failed to generate thumbnail for ${fileName}:`, thumbError);
            // Continue without thumbnail
        }
    }

    // Upload to R2 via Edge Function
    if (imagesToUpload.length > 0) {
        try {
            // Get current session
            const { data: { session } } = await supabaseClient.auth.getSession();

            if (!session) {
                throw new Error('Not authenticated');
            }

            console.log(`📤 Uploading ${imagesToUpload.length} images to R2 CDN...`);

            // Call Edge Function
            const response = await fetch(
                window.getZaoyoeSupabaseFunctionUrl('upload-to-r2'),
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ images: imagesToUpload })
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'R2 upload failed');
            }

            const result = await response.json();
            urls.push(...result.urls);

            console.log(`✅ Successfully uploaded ${result.urls.length} images to R2 CDN`);
            result.urls.forEach((url, idx) => {
                console.log(`   ${idx + 1}. ${url}`);
            });

        } catch (r2Error) {
            console.error('❌ R2 upload failed:', r2Error);

            // Fallback to Supabase Storage if R2 fails
            console.warn('⚠️ Falling back to Supabase Storage...');

            for (let i = 0; i < imagesToUpload.length; i++) {
                const { base64, filename } = imagesToUpload[i];

                try {
                    // Convert base64 to blob
                    const blob = await fetch(`data:image/webp;base64,${base64}`).then(r => r.blob());

                    const { data, error } = await supabaseClient.storage
                        .from('prompt-images')
                        .upload(filename, blob, { contentType: 'image/webp' });

                    if (error) throw error;

                    // Get public URL
                    const { data: urlData } = supabaseClient.storage
                        .from('prompt-images')
                        .getPublicUrl(filename);

                    urls.push(urlData.publicUrl);
                    console.log(`📤 Fallback upload: ${filename} (Supabase Storage)`);
                } catch (storageError) {
                    console.error(`❌ Failed to upload ${filename} to Supabase:`, storageError);
                    // Continue with other images
                }
            }

            if (urls.length === 0) {
                throw new Error('All image uploads failed (R2 and Supabase)');
            }
        }
    }

    return urls;
}


function generateCodeSnippet(promptData) {
    const snippet = `
    {
        "id": "prompt-NEW",
        "title": "${promptData.title}",
        "tags": ${JSON.stringify(promptData.tags)},
        "description": "${promptData.description.replace(/"/g, '\\"')}",
        "prompt": "${promptData.prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
        "images": ${JSON.stringify(promptData.images)},
        "dominantColors": ${JSON.stringify(promptData.dominantColors)},
        "aiTags": ${JSON.stringify(promptData.aiTags, null, 8)}
    }`;

    console.log('=== 复制以下代码到 prompts-data.js ===');
    console.log(snippet);

    // Copy to clipboard
    navigator.clipboard.writeText(snippet).then(() => {
        showToast('代码已复制到剪贴板！可粘贴到 prompts-data.js', 'success');
    });
}

// ========================================
// UTILITIES
// ========================================
function updateStatus(text, state) {
    const statusEl = document.getElementById('studioStatus');
    const dot = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');

    textEl.textContent = text;
    dot.className = 'status-dot';
    if (state === 'processing') dot.classList.add('processing');
    if (state === 'error') dot.classList.add('error');

    // Make status clickable when AI proxy is unavailable
    if (text === 'AI Proxy Missing') {
        statusEl.classList.add('clickable');
        statusEl.title = '点击查看服务端 AI 配置说明';
        statusEl.onclick = () => promptForApiKey();
    } else {
        statusEl.classList.remove('clickable');
        statusEl.title = '';
        statusEl.onclick = null;
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function resetForm() {
    uploadedFiles = [];
    analysisResult = null;
    document.getElementById('previewGrid').innerHTML = '';
    document.getElementById('promptForm').style.display = 'none';
    document.getElementById('promptForm').reset();
    document.getElementById('tagObjects').innerHTML = '';
    document.getElementById('tagScenes').innerHTML = '';
    document.getElementById('tagStyles').innerHTML = '';
    document.getElementById('tagMood').innerHTML = '';
    document.getElementById('colorSwatches').innerHTML = '';

    // Hide last edited info
    const lastEditedInfo = document.getElementById('lastEditedInfo');
    if (lastEditedInfo) lastEditedInfo.style.display = 'none';

    updateAnalyzeButton();
    updateStatus('Ready', 'ready');
}

// ========================================
// HYBRID SEARCH: Local first, AI fallback
// ========================================
let searchDebounce = null;
// [DELETED] Old search system removed - replaced by Gallery search logic below

// ========================================
// BATCH OPERATIONS
// ========================================
let isSelectMode = false;
let selectedPrompts = new Set();
let batchEditPrompts = [];
let batchEditIndex = 0;
let batchCancelled = false;
let batchPaused = false;
let batchStartTime = null;

function initBatchOperations() {
    // Selection mode toggle
    const selectModeBtn = document.getElementById('selectModeBtn');
    if (selectModeBtn) {
        selectModeBtn.addEventListener('click', toggleSelectMode);
    }

    // Batch menu trigger (collapsible dropdown)
    document.getElementById('batchMenuTrigger')?.addEventListener('click', toggleBatchMenu);

    // Batch menu items
    document.getElementById('selectAllBtn')?.addEventListener('click', selectAllPrompts);
    document.getElementById('batchEditMenuItem')?.addEventListener('click', () => { closeBatchMenu(); startBatchEdit(); });
    document.getElementById('batchReanalyzeMenuItem')?.addEventListener('click', () => { closeBatchMenu(); startBatchReanalyze(); });
    document.getElementById('analyzeUntaggedMenuItem')?.addEventListener('click', () => { closeBatchMenu(); analyzeUntaggedPrompts(); });
    document.getElementById('batchDeleteMenuItem')?.addEventListener('click', () => { closeBatchMenu(); showDeleteConfirmation(); });

    // Close batch menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.batch-menu-container')) {
            closeBatchMenu();
        }
    });

    // Batch edit dropdown
    document.getElementById('batchEditCurrent')?.addEventListener('click', toggleBatchEditDropdown);
    document.getElementById('batchEditClose')?.addEventListener('click', exitBatchEditMode);

    // Close batch edit dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.batch-edit-dropdown')) {
            closeBatchEditDropdown();
        }
    });

    // Progress modal buttons
    document.getElementById('batchPauseBtn')?.addEventListener('click', toggleBatchPause);
    document.getElementById('batchCancelBtn')?.addEventListener('click', cancelBatch);

    // Delete confirmation
    document.getElementById('deleteConfirmCancel')?.addEventListener('click', hideDeleteConfirmation);
    document.getElementById('deleteConfirmOk')?.addEventListener('click', executeBatchDelete);

    // Lightbox
    document.getElementById('lightboxClose')?.addEventListener('click', closeLightbox);
    document.getElementById('lightboxOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'lightboxOverlay') closeLightbox();
    });

    // Crop modal
    document.getElementById('cropCancel')?.addEventListener('click', closeCropModal);
    document.getElementById('cropApply')?.addEventListener('click', applyCrop);

    // Global keyboard events for image preview
    document.addEventListener('keydown', handleImageKeydown);
}

// Toggle batch menu dropdown
function toggleBatchMenu() {
    const container = document.getElementById('batchMenuContainer');
    container.classList.toggle('open');
}

function closeBatchMenu() {
    document.getElementById('batchMenuContainer')?.classList.remove('open');
}

// Select all prompts (only visible cards)
function selectAllPrompts() {
    // Only select cards that are NOT hidden by search filter
    const cards = document.querySelectorAll('.admin-card:not([style*="display: none"])');
    cards.forEach(card => {
        const id = card.dataset.id; // UUID string, not parseInt
        if (!selectedPrompts.has(id)) {
            selectedPrompts.add(id);
            card.classList.add('selected');
        }
    });
    updateBatchButtonStates();
    closeBatchMenu();
}

// Toggle selection mode
function toggleSelectMode() {
    isSelectMode = !isSelectMode;
    const grid = document.getElementById('adminGrid');
    const selectModeBtn = document.getElementById('selectModeBtn');
    const batchMenuContainer = document.getElementById('batchMenuContainer');
    const promptCountWrapper = document.getElementById('promptCountWrapper');

    grid.classList.toggle('select-mode', isSelectMode);
    selectModeBtn.classList.toggle('active', isSelectMode);

    // Show/hide the ... button and auto-open dropdown when entering select mode
    if (isSelectMode) {
        batchMenuContainer.style.display = 'block';
        batchMenuContainer.classList.add('open'); // Auto-open dropdown
        attachCardSelectionListeners();
    } else {
        batchMenuContainer.style.display = 'none';
        batchMenuContainer.classList.remove('open');
        selectedPrompts.clear();
        document.querySelectorAll('.admin-card.selected').forEach(card => {
            card.classList.remove('selected');
        });
        // Hide count when exiting select mode
        if (promptCountWrapper) promptCountWrapper.style.display = 'none';
    }

    updateBatchButtonStates();
}

// Attach click listeners for card selection (using event delegation)
function attachCardSelectionListeners() {
    const grid = document.getElementById('adminGrid');
    if (!grid.hasAttribute('data-selection-listener')) {
        grid.setAttribute('data-selection-listener', 'true');
        grid.addEventListener('click', (e) => {
            if (!isSelectMode) return;
            const card = e.target.closest('.admin-card');
            if (!card) return;
            // Don't select if clicking on action buttons (though they're hidden in select mode)
            if (e.target.closest('.admin-card-actions')) return;

            const id = card.dataset.id; // UUID string
            if (selectedPrompts.has(id)) {
                selectedPrompts.delete(id);
                card.classList.remove('selected');
            } else {
                selectedPrompts.add(id);
                card.classList.add('selected');
            }
            updateBatchButtonStates();
        });
    }
}

// Handle card selection
function handleCardSelection(e) {
    if (!isSelectMode) return;
    // Don't select if clicking on action buttons
    if (e.target.closest('.admin-card-actions')) return;

    const card = e.currentTarget;
    const id = card.dataset.id; // UUID string

    if (selectedPrompts.has(id)) {
        selectedPrompts.delete(id);
        card.classList.remove('selected');
    } else {
        selectedPrompts.add(id);
        card.classList.add('selected');
    }

    updateBatchButtonStates();
}

// Update batch button states based on selection
function updateBatchButtonStates() {
    const count = selectedPrompts.size;
    const promptCountWrapper = document.getElementById('promptCountWrapper');
    const selectedCountEl = document.getElementById('selectedCount');

    // Update selected count display
    if (selectedCountEl) {
        selectedCountEl.textContent = count;
    }

    // Show/hide count wrapper based on selection
    if (promptCountWrapper) {
        promptCountWrapper.style.display = count > 0 ? 'block' : 'none';
    }
}

// Get selected prompts data
function getSelectedPromptsData() {
    return allPrompts.filter(p => selectedPrompts.has(String(p.id))); // 将ID转为字符串比较
}

// ========================================
// COMMENT VIEW SWITCHING
// ========================================
function switchCommentView(viewName) {
    // Update active tab buttons
    document.querySelectorAll('.admin-tab[data-comment-view]').forEach(tab => {
        const isActive = tab.dataset.commentView === viewName;
        tab.classList.toggle('active', isActive);

        // Update sliding indicator position
        if (isActive) {
            updateAdminTabIndicator(tab);
        }
    });

    // Switch actual content
    console.log(`Switching comment view to: ${viewName}`);

    // Call loadComments from admin-comments.js if available
    if (typeof loadComments === 'function') {
        // Update global state if it exists (usually defined in admin-comments.js)
        if (typeof currentCommentView !== 'undefined') {
            currentCommentView = viewName;
        }
        loadComments(viewName);
    } else {
        console.warn('loadComments function not found - make sure admin-comments.js is loaded');
    }
}

// ========================================
// BATCH EDIT WITH SWITCHER
// ========================================
function startBatchEdit() {
    const selected = getSelectedPromptsData();
    if (selected.length === 0) {
        showToast('请先选择要编辑的提示词', 'error');
        return;
    }

    batchEditPrompts = selected;
    batchEditIndex = 0;

    // Show batch edit bar
    const bar = document.getElementById('batchEditBar');
    bar.style.display = 'flex';

    // Switch to create view
    switchView('create');

    // Load first prompt
    loadBatchEditItem(0);
    updateBatchEditSwitcher();
}

function loadBatchEditItem(index) {
    if (index < 0 || index >= batchEditPrompts.length) return;
    batchEditIndex = index;
    editPrompt(batchEditPrompts[index].id);
    updateBatchEditSwitcher();
}

function updateBatchEditSwitcher() {
    const currentTitle = document.getElementById('batchEditCurrent').querySelector('.current-title');
    const currentIndex = document.getElementById('batchEditCurrent').querySelector('.current-index');
    const menu = document.getElementById('batchEditMenu');

    const prompt = batchEditPrompts[batchEditIndex];
    currentTitle.textContent = prompt?.title || '选择提示词...';
    currentIndex.textContent = `(${batchEditIndex + 1}/${batchEditPrompts.length})`;

    // Populate menu
    menu.innerHTML = batchEditPrompts.map((p, i) => `
        <div class="batch-edit-item ${i === batchEditIndex ? 'active' : ''}" data-index="${i}">
            <span class="check-icon">${i === batchEditIndex ? '<i class="fas fa-check"></i>' : ''}</span>
            <span>${p.title}</span>
        </div>
    `).join('');

    // Attach click listeners
    menu.querySelectorAll('.batch-edit-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index);
            loadBatchEditItem(idx);
            closeBatchEditDropdown();
        });
    });
}

function toggleBatchEditDropdown() {
    const dropdown = document.getElementById('batchEditDropdown');
    dropdown.classList.toggle('open');
}

function closeBatchEditDropdown() {
    document.getElementById('batchEditDropdown').classList.remove('open');
}

function exitBatchEditMode() {
    batchEditPrompts = [];
    batchEditIndex = 0;
    document.getElementById('batchEditBar').style.display = 'none';
    cancelEdit();
}

// Modify the form save to support batch edit navigation
const originalFormSubmit = document.getElementById('promptForm')?.onsubmit;

// ========================================
// BATCH REANALYZE
// ========================================
async function startBatchReanalyze() {
    // Check API key first
    if (!window.AdminAI?.configured) {
        showToast('请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key', 'error');
        await checkApiKey();
        return;
    }

    const selected = getSelectedPromptsData();
    if (selected.length === 0) {
        showToast('请先选择要重分析的提示词', 'error');
        return;
    }

    // Show confirmation with API cost
    if (!confirm(`确定要重分析 ${selected.length} 个提示词吗？\n\n将消耗约 ${selected.length} 次 API 请求。`)) {
        return;
    }

    await executeBatchReanalyze(selected);
}

async function analyzeUntaggedPrompts() {
    // Find prompts without AI tags
    const untagged = allPrompts.filter(p => !p.ai_tags || Object.keys(p.ai_tags).length === 0);

    if (untagged.length === 0) {
        showToast('所有提示词都已有 AI 标签', 'success');
        return;
    }

    if (!confirm(`发现 ${untagged.length} 个无标签提示词。\n\n确定要分析吗？将消耗约 ${untagged.length} 次 API 请求。`)) {
        return;
    }

    await executeBatchReanalyze(untagged);
}

async function executeBatchReanalyze(prompts) {
    const DELAY = 1500; // 1.5s between requests
    batchCancelled = false;
    batchPaused = false;
    batchStartTime = Date.now();

    showBatchProgressModal('批量重分析', prompts.length);

    let success = 0, failed = 0;
    const failedItems = [];

    for (let i = 0; i < prompts.length; i++) {
        if (batchCancelled) break;

        // Handle pause
        while (batchPaused && !batchCancelled) {
            await sleep(100);
        }
        if (batchCancelled) break;

        const prompt = prompts[i];
        updateBatchProgress(i + 1, prompts.length, prompt.title);

        try {
            await reanalyzeSinglePrompt(prompt);
            success++;
        } catch (err) {
            console.error(`Failed to reanalyze ${prompt.title}:`, err);
            failedItems.push(prompt);
            failed++;
        }

        if (i < prompts.length - 1 && !batchCancelled) {
            await sleep(DELAY);
        }
    }

    hideBatchProgressModal();

    if (batchCancelled) {
        showToast(`已取消。成功 ${success} 个，失败 ${failed} 个`, 'warning');
    } else {
        showToast(`完成！成功 ${success} 个，失败 ${failed} 个`, success > 0 ? 'success' : 'error');
    }

    // Refresh grid
    await loadAdminPrompts();

    // Exit select mode
    if (isSelectMode) toggleSelectMode();
}

async function reanalyzeSinglePrompt(prompt) {
    if (!prompt.images || prompt.images.length === 0) {
        throw new Error('No images');
    }

    // Fetch image and convert to base64
    const imageUrl = prompt.images[0];
    console.log(`📷 Fetching image: ${imageUrl}`);

    let blob;
    try {
        const response = await fetch(imageUrl, { mode: 'cors' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        blob = await response.blob();
        console.log(`✅ Image fetched: ${blob.size} bytes`);
    } catch (err) {
        console.error(`❌ Image fetch failed for ${imageUrl}:`, err);
        throw new Error(`Image fetch failed: ${err.message}`);
    }
    const base64 = await blobToBase64(blob);

    // Call Gemini
    console.log(`🤖 Calling Gemini API...`);
    const result = await callGeminiVision(base64);
    console.log(`✅ Gemini response received:`, result);

    // Update in Supabase - correctly map the AI analysis fields
    // Note: callGeminiVision returns objects, scenes, styles, mood directly, not under "tags"
    const updateData = {
        ai_tags: {
            objects: result.objects || { en: [], zh: [] },
            scenes: result.scenes || { en: [], zh: [] },
            styles: result.styles || { en: [], zh: [] },
            mood: result.mood || { en: [], zh: [] },
            useCase: result.useCase || {},
            commercial: result.commercial || {},
            difficulty: result.difficulty || ''
        },
        dominant_colors: result.dominantColors || []
    };

    if (result.title) updateData.title = result.title;
    if (result.category) updateData.tags = [result.category]; // category -> tags array
    if (result.description) updateData.description = result.description;

    console.log(`💾 Updating Supabase with:`, updateData);

    const { error } = await supabaseClient
        .from('prompts')
        .update(updateData)
        .eq('id', prompt.id);

    if (error) {
        console.error(`❌ Supabase update failed:`, error);
        throw error;
    }

    console.log(`✅ Prompt ${prompt.id} reanalyzed successfully`);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ========================================
// BATCH DELETE
// ========================================
function showDeleteConfirmation() {
    const count = selectedPrompts.size;
    if (count === 0) return;

    document.getElementById('deleteConfirmText').textContent =
        `确定要删除选中的 ${count} 个提示词吗？`;
    document.getElementById('deleteConfirmOverlay').style.display = 'flex';
}

function hideDeleteConfirmation() {
    document.getElementById('deleteConfirmOverlay').style.display = 'none';
}

async function executeBatchDelete() {
    hideDeleteConfirmation();

    const ids = Array.from(selectedPrompts);

    try {
        const { error } = await supabaseClient
            .from('prompts')
            .delete()
            .in('id', ids);

        if (error) throw error;

        showToast(`成功删除 ${ids.length} 个提示词`, 'success');
        await loadAdminPrompts();

        // Exit select mode
        selectedPrompts.clear();
        if (isSelectMode) toggleSelectMode();

    } catch (err) {
        console.error('Batch delete error:', err);
        showToast('删除失败: ' + err.message, 'error');
    }
}

// ========================================
// PROGRESS MODAL
// ========================================
function showBatchProgressModal(title, total) {
    document.getElementById('batchModalTitle').textContent = title;
    document.getElementById('batchProgressOverlay').style.display = 'flex';
    updateBatchProgress(0, total, '准备中...');
}

function hideBatchProgressModal() {
    document.getElementById('batchProgressOverlay').style.display = 'none';
}

function updateBatchProgress(current, total, currentItem) {
    const percent = Math.round((current / total) * 100);
    document.getElementById('batchCurrentItem').textContent = `正在分析: ${currentItem}`;
    document.getElementById('batchProgressFill').style.width = `${percent}%`;
    document.getElementById('batchProgressText').textContent = `${current}/${total} (${percent}%)`;

    // Estimate remaining time
    if (current > 0 && batchStartTime) {
        const elapsed = Date.now() - batchStartTime;
        const perItem = elapsed / current;
        const remaining = perItem * (total - current);
        const remainingSec = Math.round(remaining / 1000);
        document.getElementById('batchTimeRemaining').textContent =
            `预计剩余: 约 ${remainingSec} 秒`;
    }
}

function toggleBatchPause() {
    batchPaused = !batchPaused;
    const btn = document.getElementById('batchPauseBtn');
    if (batchPaused) {
        btn.innerHTML = '<i class="fas fa-play"></i> 继续';
    } else {
        btn.innerHTML = '<i class="fas fa-pause"></i> 暂停';
    }
}

function cancelBatch() {
    batchCancelled = true;
    batchPaused = false;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// IMAGE PREVIEW & CROP
// ========================================
let hoveredPreviewItem = null;

function handleImageKeydown(e) {
    // Spacebar for preview when hovering over preview items
    if (e.code === 'Space' && hoveredPreviewItem) {
        e.preventDefault();
        openLightbox(hoveredPreviewItem.querySelector('img')?.src);
    }

    // Escape to close lightbox
    if (e.code === 'Escape') {
        closeLightbox();
        closeCropModal();
    }
}

// Track hovered preview items
document.addEventListener('mouseover', (e) => {
    const previewItem = e.target.closest('.preview-item');
    if (previewItem) {
        hoveredPreviewItem = previewItem;
    }
});

document.addEventListener('mouseout', (e) => {
    const previewItem = e.target.closest('.preview-item');
    if (previewItem) {
        hoveredPreviewItem = null;
    }
});

function openLightbox(src) {
    if (!src) return;
    document.getElementById('lightboxImage').src = src;
    document.getElementById('lightboxOverlay').style.display = 'flex';
}

function closeLightbox() {
    document.getElementById('lightboxOverlay').style.display = 'none';
}

// ========================================
// IMAGE CROP FUNCTIONALITY (Cropper.js)
// ========================================
let cropImageIndex = null;
let cropperInstance = null;

function openCropModal(index) {
    cropImageIndex = index;
    const file = uploadedFiles[index];
    if (!file) return;

    const cropImage = document.getElementById('cropImage');
    cropImage.src = file.dataUrl;
    document.getElementById('cropModalOverlay').style.display = 'flex';

    // Wait for image to load before initializing Cropper
    cropImage.onload = function () {
        // Destroy previous instance if exists
        if (cropperInstance) {
            cropperInstance.destroy();
        }

        // Initialize Cropper.js
        cropperInstance = new Cropper(cropImage, {
            viewMode: 1,
            dragMode: 'move',
            aspectRatio: NaN, // Free aspect ratio by default
            autoCropArea: 0.8,
            restore: false,
            guides: true,
            center: true,
            highlight: true,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            responsive: true,
            background: true,
        });

        // Reset aspect ratio buttons
        document.querySelectorAll('.crop-aspect-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.aspect === 'free') {
                btn.classList.add('active');
            }
        });
    };
}

function closeCropModal() {
    document.getElementById('cropModalOverlay').style.display = 'none';
    cropImageIndex = null;

    // Destroy Cropper instance
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
}

function applyCrop() {
    if (!cropperInstance || cropImageIndex === null) {
        showToast('请先选择裁切区域', 'error');
        return;
    }

    try {
        // Get cropped canvas
        const croppedCanvas = cropperInstance.getCroppedCanvas({
            maxWidth: 2048,
            maxHeight: 2048,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        });

        if (!croppedCanvas) {
            showToast('裁切失败，请重试', 'error');
            return;
        }

        // Convert to data URL
        const croppedDataUrl = croppedCanvas.toDataURL('image/png', 1.0);

        // Extract base64 data (remove the data:image/png;base64, prefix)
        const croppedBase64 = croppedDataUrl.split(',')[1];

        // Update the file in uploadedFiles array - IMPORTANT: update both dataUrl AND base64
        const originalFile = uploadedFiles[cropImageIndex];
        uploadedFiles[cropImageIndex] = {
            ...originalFile,
            dataUrl: croppedDataUrl,
            base64: croppedBase64,  // This is what uploadImages() uses!
            url: null,  // CLEAR url so this cropped image gets uploaded as new!
            cropped: true
        };

        // Update preview thumbnail
        const previewItems = document.querySelectorAll('.preview-item img');
        if (previewItems[cropImageIndex]) {
            previewItems[cropImageIndex].src = croppedDataUrl;
        }

        showToast('裁切成功！', 'success');
        closeCropModal();

    } catch (err) {
        console.error('Crop error:', err);
        showToast('裁切失败: ' + err.message, 'error');
    }
}

// Aspect ratio button handler
document.addEventListener('click', (e) => {
    const aspectBtn = e.target.closest('.crop-aspect-btn');
    if (aspectBtn && cropperInstance) {
        // Update active state
        document.querySelectorAll('.crop-aspect-btn').forEach(btn => btn.classList.remove('active'));
        aspectBtn.classList.add('active');

        // Set aspect ratio
        const aspect = aspectBtn.dataset.aspect;
        if (aspect === 'free') {
            cropperInstance.setAspectRatio(NaN);
        } else {
            cropperInstance.setAspectRatio(parseFloat(aspect));
        }
    }
});

// Attach click-to-crop on preview items
document.addEventListener('click', (e) => {
    const previewItem = e.target.closest('.preview-item');
    if (previewItem && !e.target.closest('.remove-btn')) {
        const index = Array.from(previewItem.parentElement.children).indexOf(previewItem);
        if (index >= 0) {
            openCropModal(index);
        }
    }
});

// ========================================
// STARRY SKY (Dark Mode Embellishment)
// ========================================
function initStarrySky() {
    const canvas = document.getElementById('starryCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let stars = [];
    let shootingStars = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initStars();
    }

    class Star {
        constructor() {
            this.reset();
        }

        reset() {
            // Random position - concentrated at top
            if (Math.random() < 0.75) {
                this.y = Math.random() * (canvas.height * 0.35);
            } else {
                this.y = Math.random() * canvas.height * 0.6;
            }
            this.x = Math.random() * canvas.width;

            // Size
            this.size = Math.random() * 1.2 + 0.4;

            // Lifecycle: each star fades in, stays, fades out, then waits
            this.maxAlpha = Math.random() * 0.5 + 0.3;
            this.currentAlpha = 0;
            this.phase = 'waiting'; // waiting, fadingIn, visible, fadingOut
            this.waitTime = Math.random() * 8000 + 2000; // 2-10 seconds wait
            this.fadeSpeed = Math.random() * 0.008 + 0.003;
            this.visibleDuration = Math.random() * 4000 + 2000; // 2-6 seconds visible
            this.timer = 0;
            this.lastTime = performance.now();
        }

        update() {
            const now = performance.now();
            const delta = now - this.lastTime;
            this.lastTime = now;
            this.timer += delta;

            switch (this.phase) {
                case 'waiting':
                    if (this.timer >= this.waitTime) {
                        this.phase = 'fadingIn';
                        this.timer = 0;
                    }
                    break;
                case 'fadingIn':
                    this.currentAlpha += this.fadeSpeed;
                    if (this.currentAlpha >= this.maxAlpha) {
                        this.currentAlpha = this.maxAlpha;
                        this.phase = 'visible';
                        this.timer = 0;
                    }
                    break;
                case 'visible':
                    // Slight twinkle while visible
                    this.currentAlpha = this.maxAlpha * (0.85 + Math.sin(this.timer * 0.002) * 0.15);
                    if (this.timer >= this.visibleDuration) {
                        this.phase = 'fadingOut';
                    }
                    break;
                case 'fadingOut':
                    this.currentAlpha -= this.fadeSpeed;
                    if (this.currentAlpha <= 0) {
                        this.currentAlpha = 0;
                        this.reset(); // Relocate and restart cycle
                    }
                    break;
            }
        }

        draw() {
            if (this.currentAlpha <= 0) return;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${this.currentAlpha})`;
            ctx.fill();
        }
    }

    class ShootingStar {
        constructor() {
            this.reset();
        }

        reset() {
            this.active = false;
            this.x = 0;
            this.y = 0;
            this.length = 0;
            this.speed = 0;
            this.angle = 0;
            this.alpha = 0;
        }

        spawn() {
            this.active = true;
            this.x = Math.random() * canvas.width * 0.8;
            this.y = Math.random() * canvas.height * 0.3;
            this.length = Math.random() * 80 + 40;
            this.speed = Math.random() * 8 + 6;
            this.angle = Math.PI / 4 + (Math.random() - 0.5) * 0.3; // ~45 degrees with variation
            this.alpha = 1;
        }

        update() {
            if (!this.active) return;
            this.x += Math.cos(this.angle) * this.speed;
            this.y += Math.sin(this.angle) * this.speed;
            this.alpha -= 0.015;
            if (this.alpha <= 0 || this.x > canvas.width || this.y > canvas.height) {
                this.reset();
            }
        }

        draw() {
            if (!this.active || this.alpha <= 0) return;
            const tailX = this.x - Math.cos(this.angle) * this.length;
            const tailY = this.y - Math.sin(this.angle) * this.length;

            const gradient = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
            gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
            gradient.addColorStop(1, `rgba(255, 255, 255, ${this.alpha})`);

            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(this.x, this.y);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    function initStars() {
        stars = [];
        // Fewer stars - around 30-50 total
        const starCount = Math.floor((canvas.width * canvas.height) / 40000) + 15;
        for (let i = 0; i < starCount; i++) {
            const star = new Star();
            // Stagger initial timers so they don't all sync up
            star.timer = Math.random() * star.waitTime;
            stars.push(star);
        }

        shootingStars = [new ShootingStar(), new ShootingStar()];
    }

    // Spawn shooting star occasionally
    function maybeSpawnShootingStar() {
        if (Math.random() < 0.0008) { // ~1 every 20 seconds at 60fps
            const inactive = shootingStars.find(s => !s.active);
            if (inactive) inactive.spawn();
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        stars.forEach(star => {
            star.update();
            star.draw();
        });

        maybeSpawnShootingStar();
        shootingStars.forEach(ss => {
            ss.update();
            ss.draw();
        });

        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    resize();
    animate();
}

// ========================================
// SEARCH & DROPDOWN LOGIC (Migrated from Gallery)
// ========================================

// Hot tags cache
let HOT_TAGS_CACHE = null;

// Inverted search index for O(1) lookups
let SEARCH_INDEX = null;

// Synonym dictionary for enhanced local search
const SYNONYM_DICTIONARY = {
    // === Style synonyms ===
    'cute': ['adorable', 'kawaii', 'lovely', 'charming', '可爱', '萌', 'かわいい'],
    'vintage': ['retro', 'classic', 'nostalgic', 'old-fashioned', '复古', '怀旧', '经典'],
    'minimalist': ['minimal', 'simple', 'clean', '极简', '简约', '简洁'],
    'futuristic': ['sci-fi', 'cyberpunk', 'tech', 'future', '科幻', '未来感', '赛博朋克'],
    'dreamy': ['ethereal', 'soft', 'hazy', 'fairytale', '梦幻', '朦胧', '童话'],
    'dramatic': ['intense', 'powerful', 'bold', 'cinematic', '戏剧性', '张力', '电影感'],
    'whimsical': ['playful', 'whimsy', 'fantastical', '异想天开', '俏皮', '奇幻'],

    // === Subject synonyms ===
    'portrait': ['headshot', 'face', 'person', '人像', '头像', '肖像', '人物'],
    'landscape': ['scenery', 'nature', 'view', '风景', '山水', '自然', '风光'],
    'food': ['cuisine', 'dish', 'meal', 'culinary', '美食', '食物', '料理'],
    'animal': ['pet', 'creature', 'wildlife', '动物', '宠物', '生物'],

    // === Platform/Use case synonyms ===
    '小红书': ['xiaohongshu', 'xhs', 'red', '种草', 'rednote', '小红书封面'],
    'instagram': ['ins', 'ig', 'insta', 'gram'],
    'wallpaper': ['壁纸', 'background', '背景图', '锁屏', '桌面', '手机壁纸'],
    'avatar': ['头像', 'profile picture', 'pfp', '头图', 'icon'],
    'poster': ['海报', 'banner', '宣传图', '封面'],

    // === Mood synonyms ===
    'peaceful': ['serene', 'tranquil', 'calm', 'quiet', '平静', '安宁', '治愈', '宁静'],
    'cozy': ['warm', 'comfortable', 'homey', '温馨', '舒适', '暖心'],
    'mysterious': ['mystic', 'enigmatic', 'dark', '神秘', '迷幻', '暗黑'],
    'elegant': ['graceful', 'refined', 'sophisticated', '优雅', '典雅', '精致'],

    // === Technique synonyms ===
    'miniature': ['mini', 'tiny', 'micro', 'small', '微缩', '迷你', '微观'],
    '3d': ['three-dimensional', '3d art', '3d render', '三维', '立体'],
    'illustration': ['illustrate', 'drawing', 'artwork', '插画', '插图', '绘画'],
    'photography': ['photo', 'photograph', 'camera', '摄影', '照片', '拍摄'],

    // === Transport ===
    'bicycle': ['bike', 'cycling', '自行车', '单车', '脚踏车', '骑行'],
    'car': ['vehicle', 'auto', '汽车', '轿车', '车'],
    'train': ['midjourney train', 'railway', '火车', '列车', '高铁'],
    'plane': ['airplane', 'aircraft', 'flight', '飞机', '航班'],

    // === Nature ===
    'flower': ['floral', 'bloom', 'blossom', '花', '花卉', '鲜花'],
    'tree': ['forest', 'woods', 'nature', '树', '森林', '树木'],
    'mountain': ['hill', 'peak', 'landscape', '山', '山脉', '峰'],
    'ocean': ['sea', 'water', 'wave', 'beach', '海', '海洋', '海浪', '海滩'],
    'sky': ['cloud', 'blue sky', 'starry', '天空', '云', '星空'],
    'water': ['river', 'lake', 'stream', '水', '河流', '湖泊'],
    'snow': ['winter', 'ice', 'cold', '雪', '冬', '冰'],
    'rain': ['rainy', 'wet', 'storm', '雨', '下雨'],
    'fire': ['flame', 'burning', 'hot', '火', '火焰'],

    // === People ===
    'girl': ['woman', 'female', 'lady', '女孩', '女生', '女性', '美女'],
    'boy': ['man', 'male', 'guy', '男孩', '男生', '男性', '帅哥'],
    'child': ['kid', 'baby', 'toddler', '儿童', '小孩', '宝宝'],

    // === Fantasy ===
    'dragon': ['monster', 'beast', 'mythical', '龙', '神兽'],
    'robot': ['cyborg', 'android', 'mech', '机器人', '机甲'],
    'alien': ['ufo', 'extraterrestrial', '外星人', '异形'],
    'magic': ['spell', 'wizard', 'witch', '魔法', '法术', '巫师'],
};

// Color mapping for color search
const COLOR_MAP = {
    'red': '红', '红': 'red', '红色': 'red',
    'blue': '蓝', '蓝': 'blue', '蓝色': 'blue',
    'green': '绿', '绿': 'green', '绿色': 'green',
    'yellow': '黄', '黄': 'yellow', '黄色': 'yellow',
    'orange': '橙', '橙': 'orange', '橙色': 'orange',
    'purple': '紫', '紫': 'purple', '紫色': 'purple',
    'pink': '粉', '粉': 'pink', '粉色': 'pink',
    'black': '黑', '黑': 'black', '黑色': 'black',
    'white': '白', '白': 'white', '白色': 'white',
    'gold': '金', '金': 'gold', '金色': 'gold',
    'golden': '金', 'silver': '银', '银': 'silver', '银色': 'silver',
    'brown': '棕', '棕': 'brown', '棕色': 'brown',
    'gray': '灰', 'grey': '灰', '灰': 'gray', '灰色': 'gray',
    'cyan': '青', '青': 'cyan', '青色': 'cyan',
    'teal': '蓝绿', 'coral': '珊瑚'
};

// Gemini API for semantic search
/**
 * Normalize prompt data from Supabase format
 * Handles field name differences (ai_tags vs aiTags, dominant_colors vs dominantColors)
 */
function normalizePromptData() {
    allPrompts.forEach(p => {
        // Normalize ai_tags → aiTags
        if (p.ai_tags && !p.aiTags) {
            p.aiTags = p.ai_tags;
        }
        // Normalize dominant_colors → dominantColors
        if (p.dominant_colors && !p.dominantColors) {
            p.dominantColors = p.dominant_colors;
        }
        // Ensure arrays exist
        if (!Array.isArray(p.tags)) p.tags = [];
        if (!Array.isArray(p.dominantColors)) p.dominantColors = [];
    });
    console.log('✅ Prompt data normalized');
}

/**
 * Build inverted search index for all searchable content
 * Uses prompt.id (UUID) as the identifier
 */
function buildSearchIndex() {
    if (SEARCH_INDEX || !allPrompts || allPrompts.length === 0) return;

    console.log('🔍 Building search index...');
    SEARCH_INDEX = {};

    allPrompts.forEach(p => {
        if (!p) return;
        const id = String(p.id); // 强制转为字符串，确保与 DOM dataset.id 一致

        const addToIndex = (term) => {
            if (!term || term.length < 2) return;
            const key = term.toLowerCase().trim();
            if (!SEARCH_INDEX[key]) SEARCH_INDEX[key] = [];
            if (!SEARCH_INDEX[key].includes(id)) {
                SEARCH_INDEX[key].push(id);
            }
        };

        // Index title words
        if (p.title) {
            p.title.split(/\s+/).forEach(addToIndex);
            addToIndex(p.title);
        }

        // Index tags
        if (p.tags) {
            p.tags.forEach(addToIndex);
        }

        // Index AI tags (all categories, both languages)
        const aiTags = p.aiTags || p.ai_tags;
        if (aiTags) {
            // 基础标签类别
            ['objects', 'scenes', 'styles', 'mood'].forEach(category => {
                const tagData = aiTags[category];
                if (tagData?.en) tagData.en.forEach(addToIndex);
                if (tagData?.zh) tagData.zh.forEach(addToIndex);
            });

            // 【新增】索引 useCase (platform, purpose, format)
            if (aiTags.useCase) {
                if (aiTags.useCase.platform) aiTags.useCase.platform.forEach(addToIndex);
                if (aiTags.useCase.purpose) aiTags.useCase.purpose.forEach(addToIndex);
                if (aiTags.useCase.format) aiTags.useCase.format.forEach(addToIndex);
            }

            // 【新增】索引 commercial (niche, targetAudience)
            if (aiTags.commercial) {
                if (aiTags.commercial.niche) aiTags.commercial.niche.forEach(addToIndex);
                if (aiTags.commercial.targetAudience) aiTags.commercial.targetAudience.forEach(addToIndex);
            }

            // 【新增】索引 difficulty
            if (aiTags.difficulty) addToIndex(aiTags.difficulty);
        }

        // Index dominant colors
        const colors = p.dominantColors || p.dominant_colors;
        if (colors) {
            colors.forEach(addToIndex);
        }
    });

    console.log(`✅ Search index built: ${Object.keys(SEARCH_INDEX).length} terms`);
}

/**
 * Expand query using synonym dictionary
 */
function expandSynonyms(query) {
    const q = query.toLowerCase();
    const expanded = new Set([q]);

    for (const [key, synonyms] of Object.entries(SYNONYM_DICTIONARY)) {
        const allTerms = [key, ...synonyms].map(s => s.toLowerCase());
        if (allTerms.some(term => q.includes(term) || term.includes(q))) {
            allTerms.forEach(s => expanded.add(s.toLowerCase()));
        }
    }

    return Array.from(expanded);
}

/**
 * Perform local search with synonym expansion + index optimization
 * 【重写】使用 AND 交集策略（与 Gallery 一致）
 * Returns Set of matching prompt IDs (UUIDs)
 */
function performLocalSearch(query, searchingForColor) {
    // 初始化结果集
    let results = null;

    console.log(`🔍 Searching for: "${query}"`);

    // 颜色搜索 - 独立处理
    if (searchingForColor) {
        const colorMatches = new Set();
        allPrompts.forEach(p => {
            const colors = p.dominantColors || p.dominant_colors || [];
            if (colors.some(c => c.toLowerCase().includes(searchingForColor))) {
                colorMatches.add(String(p.id));
            }
        });
        if (colorMatches.size > 0) {
            return colorMatches;
        }
    }

    // 将查询按空格分割为多个词
    const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);

    if (terms.length === 0) {
        return new Set();
    }

    console.log(`🔄 Search terms: [${terms.join(', ')}]`);

    // 对每个词进行搜索，使用 AND 交集策略
    for (const term of terms) {
        // 展开同义词
        const expandedTerms = expandSynonyms(term);
        const termMatches = new Set();

        // 搜索索引
        if (SEARCH_INDEX) {
            // === 策略1：原始搜索词 - 精确匹配 + 部分匹配 ===
            // 直接精确匹配
            if (SEARCH_INDEX[term]) {
                SEARCH_INDEX[term].forEach(id => termMatches.add(id));
            }
            // 部分匹配 - 只对原始搜索词进行
            if (term.length >= 2) {
                Object.keys(SEARCH_INDEX).forEach(indexedTerm => {
                    // 索引词包含搜索词（如搜"自行"匹配"自行车"）
                    if (indexedTerm.includes(term)) {
                        SEARCH_INDEX[indexedTerm].forEach(id => termMatches.add(id));
                    }
                });
            }

            // === 策略2：同义词 - 只做精确匹配，不做部分匹配 ===
            // 这避免了 "bike" 等短词产生大量噪音
            for (const expandedTerm of expandedTerms) {
                if (expandedTerm !== term && SEARCH_INDEX[expandedTerm]) {
                    SEARCH_INDEX[expandedTerm].forEach(id => termMatches.add(id));
                }
            }
        }

        // 第一个词：直接赋值
        // 后续词：取交集（AND策略）
        if (results === null) {
            results = termMatches;
        } else {
            // 交集 - 只保留两个集合都有的ID
            results = new Set([...results].filter(id => termMatches.has(id)));
        }

        // 如果交集已空，提前退出
        if (results.size === 0) {
            break;
        }
    }

    // 如果索引搜索无结果，尝试线性扫描 description 和 prompt_text
    if (!results || results.size === 0) {
        console.log('🔍 Index search: 0 results, trying linear scan...');
        const fallbackResults = new Set();

        allPrompts.forEach(p => {
            const searchable = [
                p.title || '',
                p.description || '',
                p.prompt_text || '',
                (p.tags || []).join(' ')
            ].join(' ').toLowerCase();

            // 所有词都必须匹配（AND策略）
            const allTermsMatch = terms.every(term => searchable.includes(term));
            if (allTermsMatch) {
                fallbackResults.add(String(p.id));
            }
        });

        return fallbackResults;
    }

    console.log(`✅ Local search: found ${results.size} results`);
    return results;
}

/**
 * AI Semantic Search using Gemini 2.0 Flash
 * Returns Set of matching prompt IDs
 */
async function performAISemanticSearch(query) {
    const matchedIds = new Set();

    if (!window.AdminAI?.configured) {
        console.log('⚠️ No server AI proxy available for semantic search');
        return matchedIds;
    }

    try {
        const prompt = `You are a search intent analyzer for an AI art gallery.
User searched: "${query}"

Extract 5-8 specific English tags that match this search intent.
Consider: art styles, moods, subjects, colors, techniques, scenes.

Return ONLY a JSON array of lowercase tags, no explanation:
["tag1", "tag2", ...]`;

        let text = await window.AdminAI.generateText(prompt, {
            model: 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 256
            }
        });
        text = text?.trim();

        if (!text) return matchedIds;

        // Parse JSON response
        if (text.startsWith('```')) {
            text = text.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }

        const aiTags = JSON.parse(text);
        console.log(`🤖 AI extracted tags: [${aiTags.join(', ')}]`);

        // Search for these AI-extracted tags locally
        if (Array.isArray(aiTags)) {
            for (const tag of aiTags) {
                const tagLower = tag.toLowerCase();
                allPrompts.forEach(item => {
                    if (!item) return;

                    const titleMatch = item.title?.toLowerCase().includes(tagLower);
                    const tagMatch = item.tags?.some(t => t.toLowerCase().includes(tagLower));

                    let aiMatch = false;
                    const aiTagData = item.aiTags || item.ai_tags;
                    if (aiTagData) {
                        const searchIn = (arr) => arr && arr.some(t => t && t.toLowerCase().includes(tagLower));
                        aiMatch = searchIn(aiTagData.objects?.en) ||
                            searchIn(aiTagData.styles?.en) ||
                            searchIn(aiTagData.scenes?.en) ||
                            searchIn(aiTagData.mood?.en);
                    }

                    if (titleMatch || tagMatch || aiMatch) {
                        matchedIds.add(String(item.id)); // 强制转为字符串
                    }
                });
            }
        }
    } catch (e) {
        console.error('AI semantic search error:', e);
    }

    return matchedIds;
}

/**
 * Apply search results to cards
 * Uses display:none approach for performance
 */
function applySearchResults(matchedIds) {
    const grid = document.getElementById('adminGrid');
    const cards = grid.querySelectorAll('.admin-card');
    let visibleCount = 0;

    cards.forEach(card => {
        const cardId = card.dataset.id;
        const isVisible = matchedIds.has(cardId);

        if (isVisible) {
            card.style.display = '';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    // Update count
    const countEl = document.getElementById('promptCount');
    if (countEl) countEl.textContent = visibleCount;

    // Show empty message if no results
    if (visibleCount === 0) {
        const existingMsg = grid.querySelector('.no-results-message');
        if (!existingMsg) {
            const msg = document.createElement('p');
            msg.className = 'no-results-message';
            msg.style.cssText = 'grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 2rem;';
            msg.textContent = 'No prompts found matching your search.';
            grid.appendChild(msg);
        }
    } else {
        const existingMsg = grid.querySelector('.no-results-message');
        if (existingMsg) existingMsg.remove();
    }
}

/**
 * Main search function - 3 layer strategy
 * Layer 1 & 2: Local search with synonym expansion
 * Layer 3: AI semantic search (if local fails)
 */
async function filterBySearch(query) {
    const cards = document.querySelectorAll('.admin-card');

    // If no query, show all cards
    if (!query) {
        cards.forEach(card => card.style.display = '');
        const countEl = document.getElementById('promptCount');
        if (countEl) countEl.textContent = allPrompts.length;
        const existingMsg = document.querySelector('.no-results-message');
        if (existingMsg) existingMsg.remove();
        return;
    }

    // Check if query is a color search
    let searchingForColor = null;
    const queryLower = query.toLowerCase();
    if (COLOR_MAP[queryLower]) {
        searchingForColor = COLOR_MAP[queryLower];
    }

    // === 3-LAYER SEARCH STRATEGY ===
    // Layer 1 & 2: Local search (instant, no network)
    const localResults = performLocalSearch(query, searchingForColor);
    console.log(`🔍 Local search: found ${localResults.size} results for "${query}"`);

    // If local search found results, use them directly
    if (localResults.size > 0) {
        applySearchResults(localResults);
        return;
    }

    // Layer 3: AI Semantic Search (only if local search failed)
    console.log('🔍 Local search: 0 results, triggering AI semantic search...');
    const aiResults = await performAISemanticSearch(query);

    if (aiResults.size > 0) {
        console.log(`✨ AI search: found ${aiResults.size} results`);
        applySearchResults(aiResults);
    } else {
        console.log('❌ AI search: no results found');
        applySearchResults(new Set());
    }
}

/**
 * Setup search UI and event listeners
 */
function setupAdminSearch() {
    console.log('🔍 setupAdminSearch initialized (Gallery version)');
    const searchInput = document.getElementById('adminSearchInput');
    const dropdown = document.getElementById('adminSearchDropdown');
    const suggestionsSection = document.getElementById('searchSuggestions');

    if (!searchInput || !dropdown) {
        console.warn('❌ Search elements not found in DOM');
        return;
    }

    // Normalize data and build index
    normalizePromptData();
    buildSearchIndex();

    let debounceTimer;
    let isDropdownActive = false;

    // Generate hot tags from allPrompts
    function generateHotTags() {
        if (HOT_TAGS_CACHE) return;

        const tagFreq = {};
        allPrompts.forEach(p => {
            if (Array.isArray(p.tags)) {
                p.tags.forEach(tag => tagFreq[tag] = (tagFreq[tag] || 0) + 1);
            }
            const aiTags = p.aiTags || p.ai_tags;
            if (aiTags) {
                ['styles', 'mood', 'scenes'].forEach(source => {
                    const tags = aiTags[source];
                    if (tags?.en) {
                        tags.en.forEach(t => tagFreq[t] = (tagFreq[t] || 0) + 1);
                    }
                });
            }
        });

        HOT_TAGS_CACHE = Object.entries(tagFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([tag]) => tag);
    }

    function getInlineHotTags(count) {
        if (!HOT_TAGS_CACHE) generateHotTags();
        return HOT_TAGS_CACHE ? HOT_TAGS_CACHE.slice(0, count) : [];
    }

    function showDropdown() {
        if (isDropdownActive) return;
        isDropdownActive = true;
        dropdown.classList.add('active');
    }

    function hideDropdown() {
        isDropdownActive = false;
        dropdown.classList.remove('active');
    }

    // 简化的搜索建议函数 - 仅在输入时显示建议，不显示 Hot Search
    function showSuggestions(query) {
        if (!suggestionsSection) return;

        // 无查询时不显示下拉菜单
        if (!query) {
            suggestionsSection.style.display = 'none';
            hideDropdown();
            return;
        }

        // 有查询时显示匹配建议
        const suggestions = new Set();
        const lowerQuery = query.toLowerCase();

        allPrompts.forEach(p => {
            if (p.title?.toLowerCase().includes(lowerQuery)) {
                suggestions.add(p.title);
            }
            if (Array.isArray(p.tags)) {
                p.tags.forEach(tag => {
                    if (tag.toLowerCase().includes(lowerQuery)) suggestions.add(tag);
                });
            }
        });

        const suggestionArray = Array.from(suggestions).slice(0, 5);

        if (suggestionArray.length === 0) {
            suggestionsSection.style.display = 'none';
            hideDropdown();
            return;
        }

        showDropdown();
        suggestionsSection.style.display = 'flex';

        const html = suggestionArray.map(s =>
            `<div class="suggestion-item"><i class="fas fa-search"></i>${s}</div>`
        ).join('');

        suggestionsSection.innerHTML = html;

        // 添加点击事件
        suggestionsSection.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                searchInput.value = item.textContent;
                filterBySearch(item.textContent.toLowerCase());
                hideDropdown();
            });
        });
    }

    // Event Listeners - 移除 focus 事件（不再显示 Hot Search）
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        showSuggestions(query);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            filterBySearch(query.toLowerCase());
        }, 200);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            filterBySearch('');
            hideDropdown();
            searchInput.blur();
        }
    });

    // Close when clicking outside
    document.addEventListener('mousedown', (e) => {
        const wrapper = document.querySelector('.admin-search-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            hideDropdown();
        }
    });

    dropdown.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    // Generate initial hot tags
    generateHotTags();

    // === 分类和日期筛选器 ===
    const categoryFilterInput = document.getElementById('categoryFilter');
    const dateFilterInput = document.getElementById('dateFilter');

    // 综合过滤函数 - 结合搜索、分类和日期
    // 【重写】搜索部分使用 performLocalSearch 统一入口
    function applyAllFilters() {
        const searchQuery = searchInput.value.trim().toLowerCase();
        const categoryValue = categoryFilterInput?.value || '';
        const dateValue = dateFilterInput?.value || '';

        const cards = document.querySelectorAll('.admin-card');
        let visibleCount = 0;

        // 日期计算
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const monthStart = new Date(todayStart);
        monthStart.setMonth(monthStart.getMonth() - 1);

        // 【统一入口】如果有搜索词，使用 performLocalSearch 获取匹配ID集合
        let searchMatchedIds = null;
        if (searchQuery) {
            // 检查是否是颜色搜索
            let searchingForColor = null;
            if (COLOR_MAP[searchQuery]) {
                searchingForColor = COLOR_MAP[searchQuery];
            }
            searchMatchedIds = performLocalSearch(searchQuery, searchingForColor);
            console.log(`📊 Search matched ${searchMatchedIds.size} IDs`);
        }

        cards.forEach(card => {
            const cardId = card.dataset.id;
            const prompt = allPrompts.find(p => String(p.id) === cardId);
            if (!prompt) {
                card.style.display = 'none';
                return;
            }

            let visible = true;

            // 1. 分类筛选
            if (categoryValue) {
                const tags = prompt.tags || [];
                const hasCategory = tags.some(t => t.toLowerCase() === categoryValue.toLowerCase());
                if (!hasCategory) visible = false;
            }

            // 2. 日期筛选
            if (visible && dateValue) {
                const createdAt = new Date(prompt.created_at);
                switch (dateValue) {
                    case 'today':
                        if (createdAt < todayStart) visible = false;
                        break;
                    case 'week':
                        if (createdAt < weekStart) visible = false;
                        break;
                    case 'month':
                        if (createdAt < monthStart) visible = false;
                        break;
                }
            }

            // 3. 搜索筛选 - 使用统一的 performLocalSearch 结果
            if (visible && searchMatchedIds !== null) {
                if (!searchMatchedIds.has(cardId)) {
                    visible = false;
                }
            }

            card.style.display = visible ? '' : 'none';
            if (visible) visibleCount++;
        });

        // 更新计数
        const countEl = document.getElementById('promptCount');
        if (countEl) countEl.textContent = visibleCount;

        // 显示/移除无结果消息
        const grid = document.getElementById('adminGrid');
        const existingMsg = grid.querySelector('.no-results-message');
        if (visibleCount === 0) {
            if (!existingMsg) {
                const msg = document.createElement('p');
                msg.className = 'no-results-message';
                msg.style.cssText = 'grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 2rem;';
                msg.textContent = '没有找到匹配的提示词';
                grid.appendChild(msg);
            }
        } else if (existingMsg) {
            existingMsg.remove();
        }
    }

    // 监听分类筛选器变化
    if (categoryFilterInput) {
        categoryFilterInput.addEventListener('change', () => {
            console.log('📂 Category filter changed:', categoryFilterInput.value);
            applyAllFilters();
        });
    }

    // 监听日期筛选器变化
    if (dateFilterInput) {
        dateFilterInput.addEventListener('change', () => {
            console.log('📅 Date filter changed:', dateFilterInput.value);
            applyAllFilters();
        });
    }

    console.log('✅ Admin search setup complete');
}
