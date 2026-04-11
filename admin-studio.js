/* ========================================
   ADMIN STUDIO - JavaScript
   AI-Powered Prompt Upload System
   ======================================== */

// ========================================
// CONFIGURATION
// ========================================
const DEFAULT_ADMIN_VISION_MODEL = 'gemini-2.5-flash';

// State
let uploadedFiles = [];
let analysisResult = null;
let currentEditingPromptImageUrls = [];
window.currentUserPermissions = [];
window.isSuperAdmin = false;
window.isAdmin = false;
window.adminStudioAccessGranted = false;
const ADMIN_STUDIO_HIDDEN_CLASS = 'admin-studio-inline-style-attr-3';
const ADMIN_SCROLLBAR_AUTO_HIDE_CLASS = 'admin-scrollbar-auto-hide';
const ADMIN_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS = 'admin-scrollbar-auto-hide--visible';
const ADMIN_SCROLLBAR_AUTO_HIDE_BOUND_ATTR = 'data-admin-scrollbar-auto-hide-bound';
const ADMIN_GALLERY_LIST_REFRESH_TTL_MS = 15000;
const ADMIN_MODAL_SCROLL_LOCK_SELECTORS = [
    '.modal-overlay.active',
    '.user-modal-overlay.active',
    '.custom-modal-overlay.active',
    '.batch-export-modal-overlay.active',
    '.admin-ledger-modal-overlay.active',
    '.batch-modal-overlay.active',
    '.batch-action-modal-overlay.active',
    '.codes-modal-overlay.is-visible',
    '.edit-modal-overlay.is-visible',
    '#ticketReplyModal.is-visible',
    '#ticketBulkProcessModal.is-visible',
    '.shop-refund-modal-overlay.is-visible',
    '.shop-order-content-overlay.is-visible',
    '.shop-inventory-detail-overlay.is-visible'
].join(', ');
const ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR = [
    '.select-options',
    '.modal-content',
    '.user-modal-left',
    '.user-tab-content',
    '.users-notes-list',
    '.users-audit-list',
    '.codes-modal-body',
    '.edit-modal-form',
    '.admin-ledger-modal-body',
    '.ban-user-modal .modal-body',
    '.locked-accounts-list',
    '.verify-monitor-list--compact',
    '.admin-audit-monitor-panel__body--compact',
    '.config-textarea',
    '.premium-modal-layout',
    '.product-list-container',
    '.inventory-textarea',
    '.shop-inventory-detail-modal',
    '.shop-inventory-detail-entry-list',
    '.shop-order-content-box',
    '.custom-scrollbar',
    '#discountGenerateModal > div',
    '#ticketReplyModal > div',
    '#ticketBulkProcessModal > div',
    '.admin-ticket-reply-modal__context-column',
    '.admin-ticket-reply-modal__description',
    '#shopRiskCaseComposerModal > div'
].join(', ');

function markAdminScrollbarActive(target) {
    if (!(target instanceof HTMLElement)) return;

    target.classList.add(ADMIN_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS);

    if (target.__adminScrollbarHideTimer) {
        window.clearTimeout(target.__adminScrollbarHideTimer);
    }

    target.__adminScrollbarHideTimer = window.setTimeout(() => {
        target.classList.remove(ADMIN_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS);
        target.__adminScrollbarHideTimer = null;
    }, 720);
}

function bindAdminScrollbarAutoHide(target) {
    if (!(target instanceof HTMLElement)) return;
    if (target.getAttribute(ADMIN_SCROLLBAR_AUTO_HIDE_BOUND_ATTR) === '1') return;

    target.setAttribute(ADMIN_SCROLLBAR_AUTO_HIDE_BOUND_ATTR, '1');
    target.classList.add(ADMIN_SCROLLBAR_AUTO_HIDE_CLASS);
    target.addEventListener('mouseenter', () => markAdminScrollbarActive(target), { passive: true });
    target.addEventListener('scroll', () => markAdminScrollbarActive(target), { passive: true });
}

function collectAdminScrollbarTargets(root) {
    const targets = [];

    if (root instanceof Element && root.matches(ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR)) {
        targets.push(root);
    }

    if (root instanceof Element || root instanceof DocumentFragment || root === document) {
        targets.push(...root.querySelectorAll(ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR));
    }

    return targets;
}

function initAdminScrollbarAutoHide(root = document) {
    const targets = collectAdminScrollbarTargets(root);
    for (const target of targets) {
        bindAdminScrollbarAutoHide(target);
    }
}

function observeAdminScrollbarAutoHide() {
    if (document.documentElement.dataset.adminScrollbarAutoHideObserver === '1') {
        return;
    }

    document.documentElement.dataset.adminScrollbarAutoHideObserver = '1';
    initAdminScrollbarAutoHide(document);

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                initAdminScrollbarAutoHide(node);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    window.__adminScrollbarAutoHideObserver = observer;
}

const adminStudioModalScrollLockState = {
    locked: false,
    activeModal: null,
    fallbackScrollY: 0,
    scrollbarGap: 0
};

function measureAdminStudioScrollbarGap() {
    const viewportWidth = window.innerWidth || 0;
    const documentWidth = document.documentElement?.clientWidth || 0;
    return Math.max(0, Math.round(viewportWidth - documentWidth));
}

function applyAdminStudioScrollbarGapCompensation() {
    const gap = measureAdminStudioScrollbarGap();
    adminStudioModalScrollLockState.scrollbarGap = gap;
    document.documentElement.style.setProperty('--admin-scroll-lock-gap', `${gap}px`);
}

function clearAdminStudioScrollbarGapCompensation() {
    adminStudioModalScrollLockState.scrollbarGap = 0;
    document.documentElement.style.removeProperty('--admin-scroll-lock-gap');
}

function getActiveAdminStudioModalOverlays() {
    return Array.from(document.querySelectorAll(ADMIN_MODAL_SCROLL_LOCK_SELECTORS)).filter((element) => {
        if (!(element instanceof HTMLElement) || !element.isConnected) {
            return false;
        }
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
            return false;
        }
        return true;
    });
}

function getTopActiveAdminStudioModalOverlay() {
    const overlays = getActiveAdminStudioModalOverlays();
    return overlays.length ? overlays[overlays.length - 1] : null;
}

function lockAdminStudioBackgroundScroll(modalElement) {
    if (!(modalElement instanceof HTMLElement)) {
        return;
    }

    adminStudioModalScrollLockState.activeModal = modalElement;

    if (!adminStudioModalScrollLockState.locked) {
        applyAdminStudioScrollbarGapCompensation();
    }

    if (window.iOSScrollLock?.lock) {
        window.iOSScrollLock.lock(modalElement);
        adminStudioModalScrollLockState.locked = true;
        return;
    }

    if (!adminStudioModalScrollLockState.locked) {
        adminStudioModalScrollLockState.fallbackScrollY = window.scrollY || window.pageYOffset || 0;
    }

    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll', 'ios-scroll-lock-fixed');
    document.body.style.setProperty('--ios-scroll-lock-offset', `-${adminStudioModalScrollLockState.fallbackScrollY}px`);
    adminStudioModalScrollLockState.locked = true;
}

function unlockAdminStudioBackgroundScroll() {
    if (window.iOSScrollLock?.unlock) {
        window.iOSScrollLock.unlock();
    } else if (adminStudioModalScrollLockState.locked) {
        const restoreScrollY = adminStudioModalScrollLockState.fallbackScrollY || 0;
        document.documentElement.classList.remove('no-scroll');
        document.body.classList.remove('no-scroll', 'ios-scroll-lock-fixed');
        document.body.style.removeProperty('--ios-scroll-lock-offset');
        window.scrollTo(0, restoreScrollY);
    }

    clearAdminStudioScrollbarGapCompensation();
    adminStudioModalScrollLockState.locked = false;
    adminStudioModalScrollLockState.activeModal = null;
}

function syncAdminStudioModalScrollLock() {
    const topModal = getTopActiveAdminStudioModalOverlay();
    if (topModal) {
        lockAdminStudioBackgroundScroll(topModal);
        return;
    }

    unlockAdminStudioBackgroundScroll();
}

function observeAdminStudioModalScrollLock() {
    if (document.documentElement.dataset.adminModalScrollLockObserver === '1') {
        return;
    }

    document.documentElement.dataset.adminModalScrollLockObserver = '1';
    syncAdminStudioModalScrollLock();

    const observer = new MutationObserver(() => {
        syncAdminStudioModalScrollLock();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style', 'open', 'aria-hidden']
    });

    window.__adminModalScrollLockObserver = observer;
}

function setAdminStudioVisibility(target, visible, visibleClass = '') {
    if (!target) return;
    target.classList.toggle(ADMIN_STUDIO_HIDDEN_CLASS, !visible);
    target.toggleAttribute('hidden', !visible);
    if (visibleClass) {
        target.classList.toggle(visibleClass, visible);
    }
}

function showAdminStudioOverlay(target, visibleClass = 'active') {
    if (!target) return;
    if (target.__adminStudioHideTimer) {
        window.clearTimeout(target.__adminStudioHideTimer);
        target.__adminStudioHideTimer = null;
    }
    target.classList.remove(ADMIN_STUDIO_HIDDEN_CLASS);
    target.removeAttribute('hidden');
    requestAnimationFrame(() => {
        target.classList.add(visibleClass);
    });
}

function hideAdminStudioOverlay(target, visibleClass = 'active', duration = 300) {
    if (!target) return;
    target.classList.remove(visibleClass);
    if (target.__adminStudioHideTimer) {
        window.clearTimeout(target.__adminStudioHideTimer);
    }
    target.__adminStudioHideTimer = window.setTimeout(() => {
        target.classList.add(ADMIN_STUDIO_HIDDEN_CLASS);
        target.setAttribute('hidden', '');
        target.__adminStudioHideTimer = null;
    }, duration);
}

function createAdminStudioEmptyElement(text, className = 'admin-empty-message', tagName = 'p') {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
}

function renderAdminStudioEmptyMessage(container, text) {
    if (!container) return;
    container.replaceChildren(createAdminStudioEmptyElement(text));
}

function syncAdminSearchCardVisibility(card, visible) {
    if (!card) return;
    card.classList.toggle('admin-card--hidden-by-search', !visible);
}

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

function getOptimizedPromptCardImageUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';

    const trimmed = url.trim();

    if (trimmed.includes('cdn.zaoyoe.com/prompts/') && !trimmed.includes('/thumb/')) {
        return trimmed.replace('/prompts/', '/prompts/thumb/');
    }

    if (trimmed.includes('supabase.co/storage/v1/object/public/prompt-images/')) {
        try {
            const optimizedUrl = new URL(trimmed);
            optimizedUrl.pathname = optimizedUrl.pathname.replace(
                '/storage/v1/object/public/',
                '/storage/v1/render/image/public/'
            );
            optimizedUrl.searchParams.set('width', '320');
            optimizedUrl.searchParams.set('height', '220');
            optimizedUrl.searchParams.set('quality', '80');
            return optimizedUrl.toString();
        } catch (error) {
            console.warn('Failed to optimize prompt card image URL:', trimmed, error);
        }
    }

    return trimmed;
}

function sanitizePromptImageUrl(url) {
    const safeUrl = sanitizeImageUrl(url);
    if (!safeUrl) return '';
    return getOptimizedPromptCardImageUrl(safeUrl);
}

function getAdminStudioSupabaseClient() {
    const client = window.supabaseClient;
    if (!client) {
        throw new Error('Supabase client unavailable');
    }
    return client;
}

async function auditPromptAction(actionType, details = {}) {
    if (typeof window.logAdminAction !== 'function') return;

    try {
        await window.logAdminAction(actionType, null, details);
    } catch (err) {
        console.warn('Prompt audit log failed:', err);
    }
}

function getAdminPromptsReadSite() {
    return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
}

function getAdminGalleryRouteUrlObject() {
    if (typeof window.getAdminStudioUrlObject === 'function') {
        const resolvedUrl = window.getAdminStudioUrlObject();
        if (resolvedUrl) {
            return resolvedUrl;
        }
    }

    try {
        return new URL(window.location.href);
    } catch (error) {
        console.warn('[Gallery] Failed to parse current URL:', error);
        return null;
    }
}

function getAdminGalleryRouteState() {
    const url = getAdminGalleryRouteUrlObject();
    const searchParams = url?.searchParams;
    return {
        view: String(searchParams?.get('gallery_view') || '').trim().toLowerCase() === 'manage' ? 'manage' : 'create',
        promptId: String(searchParams?.get('gallery_prompt_id') || '').trim()
    };
}

function syncAdminGalleryRouteState(nextState = {}, options = {}) {
    const url = getAdminGalleryRouteUrlObject();
    if (!url || typeof window.history?.replaceState !== 'function') {
        return false;
    }

    const currentState = getAdminGalleryRouteState();
    const view = Object.prototype.hasOwnProperty.call(nextState, 'view')
        ? (String(nextState.view || '').trim().toLowerCase() === 'manage' ? 'manage' : 'create')
        : currentState.view;
    const promptId = view === 'manage'
        ? (Object.prototype.hasOwnProperty.call(nextState, 'promptId')
            ? String(nextState.promptId || '').trim()
            : currentState.promptId)
        : '';

    if (options.ensureGalleryModule === true) {
        url.searchParams.delete('module');
    }

    url.searchParams.set('gallery_view', view);
    if (promptId) {
        url.searchParams.set('gallery_prompt_id', promptId);
    } else {
        url.searchParams.delete('gallery_prompt_id');
    }

    const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextRelativeUrl !== currentRelativeUrl) {
        window.history.replaceState(window.history.state, '', nextRelativeUrl);
    }

    return true;
}

function buildAdminPromptsUrl(params = {}) {
    const url = new URL('/api/admin/prompts/manage', window.location.origin);

    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });

    return `${url.pathname}${url.search}`;
}

const PROMPT_BILINGUAL_FIELD_KEYS = Object.freeze([
    'title_zh',
    'title_en',
    'description_zh',
    'description_en',
    'prompt_text_zh',
    'prompt_text_en'
]);

const PROMPT_BILINGUAL_SQL_GUIDE = 'supabase/migrations/add_bilingual_prompts_fields.sql';
const PROMPT_BILINGUAL_VERIFY_SELECT_FIELDS = [
    'id',
    'title',
    'tags',
    'description',
    'prompt_text',
    'images',
    'created_at',
    'dominant_colors',
    'ai_tags',
    ...PROMPT_BILINGUAL_FIELD_KEYS
].join(', ');

function getPromptMissingPersistedBilingualFields(attemptedPayload = {}, savedRow = {}) {
    const safeAttemptedPayload = attemptedPayload && typeof attemptedPayload === 'object' ? attemptedPayload : {};
    const safeSavedRow = savedRow && typeof savedRow === 'object' ? savedRow : {};

    return PROMPT_BILINGUAL_FIELD_KEYS.filter((fieldName) => {
        const attemptedValue = String(safeAttemptedPayload[fieldName] || '').trim();
        if (!attemptedValue) {
            return false;
        }

        const persistedValue = String(safeSavedRow[fieldName] || '').trim();
        return persistedValue !== attemptedValue;
    });
}

function isMissingPromptBilingualSchemaCacheError(error = null) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) {
        return false;
    }

    if (message.includes('prompt 双语字段') && message.includes('schema cache')) {
        return true;
    }

    const mentionsPromptField = PROMPT_BILINGUAL_FIELD_KEYS.some((fieldName) => (
        message.includes(`column ${fieldName}`)
        || message.includes(`prompts.${fieldName}`)
        || message.includes(`"${fieldName}"`)
        || message.includes(`'${fieldName}'`)
    ));

    if (!mentionsPromptField) {
        return false;
    }

    return (
        message.includes('schema cache')
        || message.includes('does not exist')
        || message.includes(`column of 'prompts'`)
        || message.includes(`column of "prompts"`)
    );
}

async function fetchPromptBilingualVerificationRow(promptId = '') {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return null;
    }

    const payload = await fetchAdminPromptItem(normalizedPromptId, {
        site: getAdminPromptsReadSite(),
        hydrateBilingual: false
    });
    return payload?.row && typeof payload.row === 'object' ? payload.row : null;
}

async function fetchPromptBilingualVerificationRows(promptIds = []) {
    const normalizedIds = [...new Set(
        (Array.isArray(promptIds) ? promptIds : [promptIds])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    )];
    if (!normalizedIds.length) {
        return [];
    }

    const payloads = await Promise.all(
        normalizedIds.map((id) => fetchAdminPromptItem(id, {
            site: getAdminPromptsReadSite(),
            hydrateBilingual: false
        }))
    );

    return payloads
        .map((payload) => payload?.row)
        .filter((row) => row && typeof row === 'object');
}

function buildPromptBilingualPersistencePayload(attemptedPayload = {}) {
    const safeAttemptedPayload = attemptedPayload && typeof attemptedPayload === 'object' ? attemptedPayload : {};
    return PROMPT_BILINGUAL_FIELD_KEYS.reduce((nextPayload, fieldName) => {
        const nextValue = String(safeAttemptedPayload[fieldName] || '').trim();
        if (nextValue) {
            nextPayload[fieldName] = nextValue;
        }
        return nextPayload;
    }, {});
}

function promptHasAnyBilingualCopy(prompt = {}) {
    return PROMPT_BILINGUAL_FIELD_KEYS.some((fieldName) => promptHasVisibleCopy(prompt?.[fieldName]));
}

async function persistPromptBilingualFieldsViaSupabase(promptId = '', attemptedPayload = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return null;
    }

    const persistencePayload = buildPromptBilingualPersistencePayload(attemptedPayload);
    if (!Object.keys(persistencePayload).length) {
        return null;
    }

    const payload = await mutateAdminPrompt({
        action: 'patch',
        site: getAdminPromptsReadSite(),
        id: normalizedPromptId,
        payload: persistencePayload
    });
    return payload?.row && typeof payload.row === 'object' ? payload.row : null;
}

async function hydratePromptRowsBilingualProjection(rows = []) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const candidateIds = safeRows
        .filter((row) => row && typeof row === 'object' && String(row.id || '').trim() && !promptHasAnyBilingualCopy(row))
        .map((row) => String(row.id || '').trim());

    if (!candidateIds.length) {
        return safeRows;
    }

    try {
        const verificationRows = await fetchPromptBilingualVerificationRows(candidateIds);
        if (!verificationRows.length) {
            return safeRows;
        }

        const verificationMap = new Map(
            verificationRows.map((row) => [String(row?.id || '').trim(), row])
        );

        return safeRows.map((row) => {
            const normalizedId = String(row?.id || '').trim();
            const verifiedRow = verificationMap.get(normalizedId);
            return verifiedRow ? { ...row, ...verifiedRow } : row;
        });
    } catch (error) {
        console.warn('[Gallery] Failed to hydrate bilingual prompt projection from Supabase:', error);
        return safeRows;
    }
}

async function verifyPromptPersistedBilingualFields(promptId = '', attemptedPayload = {}, savedRow = {}) {
    const initialMissingFields = getPromptMissingPersistedBilingualFields(attemptedPayload, savedRow);
    if (!initialMissingFields.length) {
        return {
            row: savedRow,
            missingFields: [],
            schemaMissing: false,
            verificationError: null
        };
    }

    let lastVerificationError = null;
    try {
        const verifiedRow = await fetchPromptBilingualVerificationRow(promptId);
        const mergedRow = verifiedRow
            ? {
                ...(savedRow && typeof savedRow === 'object' ? savedRow : {}),
                ...verifiedRow
            }
            : savedRow;
        const missingFieldsAfterVerification = getPromptMissingPersistedBilingualFields(attemptedPayload, mergedRow);
        if (!missingFieldsAfterVerification.length) {
            return {
                row: mergedRow,
                missingFields: [],
                schemaMissing: false,
                verificationError: null
            };
        }

        savedRow = mergedRow;
        lastVerificationError = new Error(`Prompt bilingual fields still missing after verification: ${missingFieldsAfterVerification.join(', ')}`);
    } catch (error) {
        lastVerificationError = error;
        if (isMissingPromptBilingualSchemaCacheError(error)) {
            return {
                row: savedRow,
                missingFields: initialMissingFields,
                schemaMissing: true,
                verificationError: error
            };
        }
    }

    try {
        const persistedRow = await persistPromptBilingualFieldsViaSupabase(promptId, attemptedPayload);
        const mergedRow = persistedRow
            ? {
                ...(savedRow && typeof savedRow === 'object' ? savedRow : {}),
                ...persistedRow
            }
            : savedRow;
        return {
            row: mergedRow,
            missingFields: getPromptMissingPersistedBilingualFields(attemptedPayload, mergedRow),
            schemaMissing: false,
            verificationError: null
        };
    } catch (error) {
        return {
            row: savedRow,
            missingFields: initialMissingFields,
            schemaMissing: isMissingPromptBilingualSchemaCacheError(error),
            verificationError: error || lastVerificationError
        };
    }
}

function buildPromptBilingualPersistenceWarningMessage(missingFields = []) {
    if (!Array.isArray(missingFields) || missingFields.length === 0) {
        return '';
    }

    const options = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {};
    if (options.schemaMissing) {
        return `当前 API / schema cache 还没识别到 Prompt 双语字段；如果你已执行 ${PROMPT_BILINGUAL_SQL_GUIDE}，请再执行 select pg_notify('pgrst', 'reload schema');`;
    }

    if (options.verificationError) {
        return 'Prompt 已保存，但双语字段暂未确认写入；请刷新后复查。';
    }

    return 'Prompt 已保存，但仍有双语字段未写回；请刷新后复查。';
}

function normalizeBatchPromptFailureMessage(error, prompt = {}) {
    const rawMessage = String(error?.message || '').trim();
    const promptLabel = String(
        prompt?.title
        || prompt?.title_zh
        || prompt?.title_en
        || prompt?.id
        || '未命名 Prompt'
    ).trim();

    if (!rawMessage) {
        return `${promptLabel}: 未知错误`;
    }

    return `${promptLabel}: ${rawMessage}`;
}

async function parseAdminPromptsResponse(response) {
    let payload = {};

    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }

    if (!response.ok || payload?.success === false) {
        const error = new Error(payload?.message || `Prompt request failed (${response.status})`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function fetchAdminPromptList({ site = getAdminPromptsReadSite(), hydrateBilingual = true } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPromptsUrl({ site }), {
        credentials: 'include'
    });

    const payload = await parseAdminPromptsResponse(response);
    if (hydrateBilingual && Array.isArray(payload?.rows) && payload.rows.length) {
        payload.rows = await hydratePromptRowsBilingualProjection(payload.rows);
    }
    return payload;
}

async function fetchAdminPromptItem(id, { site = getAdminPromptsReadSite(), hydrateBilingual = true } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPromptsUrl({
        id,
        site
    }), {
        credentials: 'include'
    });

    const payload = await parseAdminPromptsResponse(response);
    if (hydrateBilingual && payload?.row && typeof payload.row === 'object') {
        const [hydratedRow] = await hydratePromptRowsBilingualProjection([payload.row]);
        if (hydratedRow) {
            payload.row = hydratedRow;
        }
    }
    return payload;
}

async function mutateAdminPrompt({ action, site, id, payload = {} } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)('/api/admin/prompts/manage', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action,
            site,
            id,
            ...(payload && typeof payload === 'object' ? payload : {})
        })
    });

    return parseAdminPromptsResponse(response);
}

async function deleteAdminPrompts({ site, id, ids = [] } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)('/api/admin/prompts/manage', {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            site,
            id,
            ids
        })
    });

    return parseAdminPromptsResponse(response);
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
        setAdminStudioVisibility(primaryAction, true);
    }

    if (secondaryAction) {
        if (options.secondaryLabel) {
            secondaryAction.textContent = options.secondaryLabel;
            secondaryAction.href = options.secondaryHref || 'index.html';
            setAdminStudioVisibility(secondaryAction, true);
        } else {
            setAdminStudioVisibility(secondaryAction, false);
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

    try {
        await Promise.resolve(window.__adminStudioSessionRestoreReady);
    } catch (error) {
        console.warn('[AdminStudio] Supabase session restore wait failed:', error);
    }

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

    const access = await accessClient.getCurrentAdminAccess({
        forceRefresh: true
    });

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

    Promise.resolve()
        .then(() => accessClient.createAdminStudioSession?.({
            supabaseClient: window.supabaseClient,
            userId: access.user.id
        }))
        .then((sessionResult) => {
            window.adminStudioSessionGranted = Boolean(sessionResult?.ok);
            if (!sessionResult?.ok) {
                console.warn('[AdminStudio] Failed to issue admin studio cookie session:', sessionResult);
            }
        })
        .catch((sessionError) => {
            window.adminStudioSessionGranted = false;
            console.warn('[AdminStudio] Failed to issue admin studio cookie session:', sessionError);
        });

    return access;
}

function initializeAdminStudioShell() {
    bindAdminStudioDelegatedControls();
    observeAdminScrollbarAutoHide();
    observeAdminStudioModalScrollLock();
    initUploadZone();
    initForm();
    initCustomDropdown();
    renderCodexConfigPanel();
    checkApiKey();
    refreshCodexConfig();
    initStarrySky(); // New: Starry background
    initBatchOperations();

    // Initialize admin site filter selector
    if (window.AdminSiteFilter) window.AdminSiteFilter.renderSiteSelector();

    // Initialize system config if available
    if (typeof initSystemConfig === 'function') {
        initSystemConfig();
    }

    const galleryRouteState = getAdminGalleryRouteState();
    if (galleryRouteState.view === 'manage') {
        switchView('manage');
    }
}

function bindAdminStudioDelegatedControls() {
    if (document.documentElement.dataset.adminStudioDelegatesBound === '1') {
        return;
    }

    document.documentElement.dataset.adminStudioDelegatesBound = '1';

    function guardAdminStudioWritableAction(actionEl, event) {
        const action = String(actionEl?.dataset?.adminAction || '').trim();
        if (!action || !window.AdminSiteFilter?.actionRequiresWritableSite?.(action)) {
            return true;
        }

        const writableSite = window.AdminSiteFilter.requireWritableSite({ action });
        if (writableSite) {
            actionEl.dataset.adminWritableSite = writableSite;
            return true;
        }

        event?.preventDefault?.();
        event?.stopPropagation?.();
        return false;
    }

    function guardAdminStudioWritableForm(form, event) {
        const formId = String(form?.id || '').trim();
        if (!formId || !window.AdminSiteFilter?.formRequiresWritableSite?.(formId)) {
            return true;
        }

        const writableSite = window.AdminSiteFilter.requireWritableSite({ formId });
        if (writableSite) {
            form.dataset.adminWritableSite = writableSite;
            return true;
        }

        event?.preventDefault?.();
        event?.stopPropagation?.();
        return false;
    }

    function pulseAdminStudioDelegatedAction(actionEl) {
        if (!actionEl?.classList || actionEl.hasAttribute?.('disabled')) {
            return;
        }

        actionEl.classList.add('is-pressed');
        window.setTimeout(() => {
            actionEl.classList?.remove('is-pressed');
        }, 180);
    }

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-admin-action]');
        if (!actionEl) {
            return;
        }

        if (!guardAdminStudioWritableAction(actionEl, event)) {
            return;
        }

        pulseAdminStudioDelegatedAction(actionEl);

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
            case 'gallery-pagination-go': {
                const page = parseInt(actionEl.dataset.galleryPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.changeAdminGalleryPage?.(page);
                }
                break;
            }
            case 'gallery-open-prompt-comments':
                window.openAdminPromptCommentContext?.({
                    promptId: decodeURIComponent(actionEl.dataset.promptId || ''),
                    promptTitle: decodeURIComponent(actionEl.dataset.promptTitle || '')
                });
                break;
            case 'gallery-open-prompt-analytics':
                window.switchModule?.('growth-center', {
                    analyticsTab: 'content',
                    analyticsPromptId: decodeURIComponent(actionEl.dataset.promptId || '')
                });
                break;
            case 'gallery-add-prompt-homepage':
                window.addPromptToHomepagePromptsSection?.(decodeURIComponent(actionEl.dataset.promptId || ''));
                break;
            case 'gallery-open-prompt-homepage':
                window.HomepageAdmin?.openPromptSectionContext?.(
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    { ensureModule: true }
                );
                break;
            case 'gallery-set-status-filter':
                window.setAdminGalleryStatusFilter?.(actionEl.dataset.galleryStatusFilter || '');
                break;
            case 'gallery-batch-set-status':
                void runGalleryBatchActionFromMenu(actionEl, () => window.batchSetSelectedPromptStatus?.(actionEl.dataset.galleryBatchStatus || ''), {
                    pendingLabel: `正在${String(actionEl.querySelector('span')?.textContent || '处理批量操作').replace(/^批量/, '')}...`
                });
                break;
            case 'gallery-batch-add-homepage':
                void runGalleryBatchActionFromMenu(actionEl, () => window.batchAddSelectedPromptsToHomepage?.(), {
                    pendingLabel: '正在加入首页精选...'
                });
                break;
            case 'gallery-batch-localize':
                void runGalleryBatchActionFromMenu(actionEl, () => window.batchCompleteSelectedPromptBilingualFields?.(), {
                    pendingLabel: '正在补全双语...'
                });
                break;
            case 'ai-remove-preview': {
                const index = parseInt(actionEl.dataset.previewIndex || '', 10);
                if (!Number.isNaN(index)) {
                    removeFile(index);
                }
                break;
            }
            case 'switch-comment-view':
                (window.switchAdminCommentsView || window.switchCommentView)?.(actionEl.dataset.commentView);
                break;
            case 'comments-export':
                window.exportData?.(actionEl.dataset.exportFormat);
                break;
            case 'comments-switch-layout':
                window.switchLayoutView?.(actionEl.dataset.view);
                break;
            case 'comments-toggle-select-mode':
                window.toggleCommentsSelectMode?.();
                break;
            case 'comments-toggle-batch-menu':
                window.toggleCommentsBatchMenu?.();
                break;
            case 'comments-batch-select-all':
                window.selectAllVisibleComments?.();
                break;
            case 'comments-batch-set-status':
                window.batchSetCommentWorkflowStatus?.(actionEl.dataset.commentsBatchStatus || '', actionEl);
                break;
            case 'comments-batch-assign-self':
                window.batchAssignCommentWorkflowSelf?.(actionEl);
                break;
            case 'comments-clear-selection':
                window.clearSelectedComments?.();
                break;
            case 'comments-batch-delete':
                window.batchDeleteComments?.(actionEl);
                break;
            case 'comments-pagination-go': {
                const page = parseInt(actionEl.dataset.commentsPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.changeCommentsPage?.(page);
                }
                break;
            }
            case 'switch-settings-view':
                window.switchSettingsView?.(actionEl.dataset.settingsView);
                break;
            case 'settings-open-points-catalog':
                window.switchModule?.('points');
                window.switchPointsView?.('catalog');
                break;
            case 'switch-ops-alerts-view':
                window.switchOpsAlertsView?.(actionEl.dataset.opsAlertsView);
                break;
            case 'settings-toggle-ops-alert-strategy-panel':
                window.toggleOpsAlertStrategyPanel?.(actionEl.dataset.strategyPanel);
                break;
            case 'settings-toggle-ops-alert-summary-panel':
                window.toggleOpsAlertSummaryPanel?.(actionEl.dataset.opsAlertSummaryPanel);
                break;
            case 'settings-open-ops-alert-strategy-panel':
                window.openOpsAlertStrategyPanel?.(actionEl.dataset.strategyPanel, actionEl.dataset.strategyTab);
                break;
            case 'settings-switch-ops-alert-strategy-tab':
                window.switchOpsAlertStrategyMuteTab?.(actionEl.dataset.strategyTab);
                break;
            case 'settings-toggle-ops-alert-date-picker':
                window.toggleOpsAlertDatePicker?.(actionEl.dataset.pickerInputId);
                break;
            case 'settings-change-ops-alert-date-picker-month':
                window.changeOpsAlertDatePickerMonth?.(
                    actionEl.dataset.pickerInputId,
                    Number(actionEl.dataset.monthDelta || 0)
                );
                break;
            case 'settings-select-ops-alert-date-picker-day':
                window.selectOpsAlertDatePickerDay?.(
                    actionEl.dataset.pickerInputId,
                    Number(actionEl.dataset.pickerYear || 0),
                    Number(actionEl.dataset.pickerMonth || 0),
                    Number(actionEl.dataset.pickerDay || 0)
                );
                break;
            case 'settings-set-ops-alert-date-picker-preset':
                window.setOpsAlertDatePickerPreset?.(actionEl.dataset.pickerInputId, actionEl.dataset.pickerPreset);
                break;
            case 'settings-apply-ops-alert-date-picker':
                window.applyOpsAlertDatePicker?.(actionEl.dataset.pickerInputId);
                break;
            case 'settings-clear-ops-alert-date-picker':
                window.clearOpsAlertDatePicker?.(actionEl.dataset.pickerInputId);
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
            case 'settings-add-channel':
                window.addChannel?.();
                break;
            case 'settings-add-ops-alert-quick-reply-template':
                window.addOpsAlertCustomerChatQuickReplyTemplate?.();
                break;
            case 'settings-add-ticket-reply-template':
                window.addOpsAlertTicketReplyTemplate?.();
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
            case 'settings-focus-codex-config':
                window.focusCodexConfigPanel?.();
                break;
            case 'settings-prompt-codex-key':
                window.promptForCodexKey?.();
                break;
            case 'settings-save-codex-config':
                window.saveCodexConfig?.();
                break;
            case 'settings-test-codex-config':
                window.testCodexConnectivity?.();
                break;
            case 'settings-delete-codex-config':
                window.deleteCodexConfig?.();
                break;
            case 'settings-toggle-ops-alerts-enabled':
                window.toggleOpsAlertsEnabled?.();
                break;
            case 'settings-toggle-ops-alert-channel':
                window.toggleOpsAlertChannelEnabled?.(actionEl.dataset.alertChannel);
                break;
            case 'settings-toggle-ops-alert-temporary-mute-allow-critical':
                window.toggleOpsAlertTemporaryMuteAllowCritical?.();
                break;
            case 'settings-set-ops-alert-temporary-mute':
                window.setOpsAlertTemporaryMutePreset?.(actionEl.dataset.muteHours);
                break;
            case 'settings-clear-ops-alert-temporary-mute':
                window.clearOpsAlertTemporaryMute?.();
                break;
            case 'settings-toggle-ops-alert-mute-rule-allow-critical':
                window.toggleOpsAlertMuteRuleAllowCritical?.(actionEl.dataset.ruleScope, actionEl.dataset.ruleKey);
                break;
            case 'ops-alert-toggle-mute-row': {
                const muteRow = actionEl.closest('.ops-alert-scoped-mute-row');
                if (muteRow) muteRow.classList.toggle('is-expanded');
                break;
            }
            case 'settings-clear-ops-alert-mute-rule':
                window.clearOpsAlertMuteRule?.(actionEl.dataset.ruleScope, actionEl.dataset.ruleKey);
                break;
            case 'settings-toggle-ops-alert-quiet-hours-enabled':
                window.toggleOpsAlertQuietHoursEnabled?.();
                break;
            case 'settings-toggle-ops-alert-quiet-hours-allow-critical':
                window.toggleOpsAlertQuietHoursAllowCritical?.();
                break;
            case 'settings-toggle-ops-alert-work-hours-enabled':
                window.toggleOpsAlertWorkHoursEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-risk-auto-response':
                window.toggleOpsAlertShopRiskAutoResponseEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-inventory-enabled':
                window.toggleOpsAlertShopInventoryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-inventory-recovery-enabled':
                window.toggleOpsAlertShopInventoryRecoveryNotificationEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-inventory-summary-enabled':
                window.toggleOpsAlertShopInventorySummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-customer-chat-message-enabled':
                window.toggleOpsAlertCustomerChatMessageEnabled?.();
                break;
            case 'settings-toggle-ops-alert-customer-chat-message-summary-enabled':
                window.toggleOpsAlertCustomerChatMessageSummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-customer-chat-message-work-hours-only':
                window.toggleOpsAlertCustomerChatMessageWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-purchase-success-enabled':
                window.toggleOpsAlertShopPurchaseSuccessEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-purchase-success-summary-enabled':
                window.toggleOpsAlertShopPurchaseSuccessSummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-purchase-success-work-hours-only':
                window.toggleOpsAlertShopPurchaseSuccessWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-wallet-recharge-success-enabled':
                window.toggleOpsAlertWalletRechargeSuccessEnabled?.();
                break;
            case 'settings-toggle-ops-alert-wallet-recharge-success-summary-enabled':
                window.toggleOpsAlertWalletRechargeSuccessSummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-wallet-recharge-success-work-hours-only':
                window.toggleOpsAlertWalletRechargeSuccessWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-tickets-enabled':
                window.toggleOpsAlertTicketsEnabled?.();
                break;
            case 'settings-toggle-ops-alert-tickets-work-hours-only':
                window.toggleOpsAlertTicketsWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-tickets-summary-enabled':
                window.toggleOpsAlertTicketsSummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-order-delivery-enabled':
                window.toggleOpsAlertShopOrderDeliveryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-order-delivery-incident-enabled':
                window.toggleOpsAlertShopOrderDeliveryIncidentEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-order-delivery-work-hours-only':
                window.toggleOpsAlertShopOrderDeliveryWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-shop-order-delivery-summary-enabled':
                window.toggleOpsAlertShopOrderDeliverySummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-quota-enabled':
                window.toggleOpsAlertVerifyQuotaEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-quota-work-hours-only':
                window.toggleOpsAlertVerifyQuotaWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-quota-summary-enabled':
                window.toggleOpsAlertVerifyQuotaSummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-queue-enabled':
                window.toggleOpsAlertVerifyQueueEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-queue-work-hours-only':
                window.toggleOpsAlertVerifyQueueWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-queue-summary-enabled':
                window.toggleOpsAlertVerifyQueueSummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-failure-enabled':
                window.toggleOpsAlertVerifyFailureEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-failure-work-hours-only':
                window.toggleOpsAlertVerifyFailureWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-verify-failure-summary-enabled':
                window.toggleOpsAlertVerifyFailureSummaryEnabled?.();
                break;
            case 'settings-toggle-ops-alert-payment-gateway-enabled':
                window.toggleOpsAlertPaymentGatewayEnabled?.();
                break;
            case 'settings-toggle-ops-alert-payment-gateway-work-hours-only':
                window.toggleOpsAlertPaymentGatewayWorkHoursOnlyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-payment-gateway-summary-enabled':
                window.toggleOpsAlertPaymentGatewaySummaryEnabled?.();
                break;
            case 'settings-select-ops-alert-unified-summary-targets':
                window.selectOpsAlertUnifiedSummaryTargets?.(actionEl.dataset.opsAlertSummaryTargetPreset);
                break;
            case 'settings-apply-ops-alert-unified-summary-draft':
                window.applyOpsAlertUnifiedSummaryDraft?.();
                break;
            case 'settings-save-ops-alerts':
                window.saveOpsAlertSettings?.();
                break;
            case 'settings-send-ops-alert-telegram-test':
                window.sendOpsAlertTelegramTest?.();
                break;
            case 'settings-send-ops-alert-refund-sample':
                window.sendOpsAlertRefundSample?.();
                break;
            case 'settings-send-ops-alert-customer-chat-message-sample':
                window.sendOpsAlertCustomerChatMessageSample?.();
                break;
            case 'settings-send-ops-alert-shop-purchase-succeeded-sample':
                window.sendOpsAlertShopPurchaseSucceededSample?.();
                break;
            case 'settings-send-ops-alert-wallet-recharge-succeeded-sample':
                window.sendOpsAlertWalletRechargeSucceededSample?.();
                break;
            case 'settings-send-ops-alert-gateway-sample':
                window.sendOpsAlertGatewaySample?.();
                break;
            case 'settings-send-ops-alert-gateway-recovered-sample':
                window.sendOpsAlertGatewayRecoveredSample?.();
                break;
            case 'settings-send-ops-alert-verify-service-disabled-sample':
                window.sendOpsAlertVerifyServiceDisabledSample?.();
                break;
            case 'settings-send-ops-alert-verify-queue-backlog-sample':
                window.sendOpsAlertVerifyQueueBacklogSample?.();
                break;
            case 'settings-send-ops-alert-verify-failure-rate-spike-sample':
                window.sendOpsAlertVerifyFailureRateSpikeSample?.();
                break;
            case 'settings-send-ops-alert-verify-incident-escalated-sample':
                window.sendOpsAlertVerifyIncidentEscalatedSample?.();
                break;
            case 'settings-send-ops-alert-verify-incident-recovered-sample':
                window.sendOpsAlertVerifyIncidentRecoveredSample?.();
                break;
            case 'settings-send-ops-alert-verify-quota-sample':
                window.sendOpsAlertVerifyQuotaSample?.();
                break;
            case 'settings-send-ops-alert-ticket-sla-sample':
                window.sendOpsAlertTicketSlaSample?.();
                break;
            case 'settings-send-ops-alert-ticket-sla-recovered-sample':
                window.sendOpsAlertTicketSlaRecoveredSample?.();
                break;
            case 'settings-send-ops-alert-shop-inventory-sample':
                window.sendOpsAlertShopInventorySample?.();
                break;
            case 'settings-send-ops-alert-shop-inventory-recovered-sample':
                window.sendOpsAlertShopInventoryRecoveredSample?.();
                break;
            case 'settings-send-ops-alert-admin-login-anomaly-sample':
                window.sendOpsAlertAdminLoginAnomalySample?.();
                break;
            case 'settings-send-ops-alert-shop-order-delivery-failed-sample':
                window.sendOpsAlertShopOrderDeliveryFailedSample?.();
                break;
            case 'settings-send-ops-alert-shop-order-delivery-incident-sample':
                window.sendOpsAlertShopOrderDeliveryIncidentSample?.();
                break;
            case 'settings-send-ops-alert-shop-order-delivery-incident-recovered-sample':
                window.sendOpsAlertShopOrderDeliveryIncidentRecoveredSample?.();
                break;
            case 'settings-send-ops-alert-shop-order-delivery-recovered-sample':
                window.sendOpsAlertShopOrderDeliveryRecoveredSample?.();
                break;
            case 'settings-send-ops-alert-payment-config-changed-sample':
                window.sendOpsAlertPaymentConfigChangedSample?.();
                break;
            case 'settings-send-ops-alert-payment-config-incident-sample':
                window.sendOpsAlertPaymentConfigIncidentSample?.();
                break;
            case 'settings-send-ops-alert-payment-config-incident-recovered-sample':
                window.sendOpsAlertPaymentConfigIncidentRecoveredSample?.();
                break;
            case 'settings-send-ops-alert-payment-config-recovered-sample':
                window.sendOpsAlertPaymentConfigRecoveredSample?.();
                break;
            case 'settings-refresh-ops-alert-health':
                window.refreshOpsAlertHealthPanel?.();
                break;
            case 'settings-scroll-ops-alert-health':
                window.scrollToOpsAlertHealthPanel?.();
                break;
            case 'settings-filter-ops-alert-monitor':
                window.setOpsAlertMonitorFilter?.(
                    actionEl.dataset.opsAlertMonitorFilterKind,
                    actionEl.dataset.opsAlertMonitorFilterValue
                );
                break;
            case 'settings-open-ops-alert-workspace':
                window.openOpsAlertWorkspace?.(
                    actionEl.dataset.workspaceTarget,
                    (typeof window.readOpsAlertWorkspaceContextDataset === 'function'
                        ? window.readOpsAlertWorkspaceContextDataset(actionEl.dataset)
                        : {
                            alertType: actionEl.dataset.workspaceAlertType,
                            category: actionEl.dataset.workspaceCategory,
                            referenceLabel: actionEl.dataset.workspaceReferenceLabel,
                            referenceValue: actionEl.dataset.workspaceReferenceValue,
                            targetId: actionEl.dataset.workspaceTargetId,
                            userId: actionEl.dataset.workspaceUserId,
                            clientIp: actionEl.dataset.workspaceClientIp,
                            discountCode: actionEl.dataset.workspaceDiscountCode
                        })
                );
                break;
            case 'settings-handle-shop-risk-action':
                window.handleShopRiskAction?.(
                    actionEl.dataset.shopRiskAction,
                    (typeof window.readOpsAlertWorkspaceContextDataset === 'function'
                        ? window.readOpsAlertWorkspaceContextDataset(actionEl.dataset)
                        : {
                            title: actionEl.dataset.workspaceTitle,
                            alertType: actionEl.dataset.workspaceAlertType,
                            category: actionEl.dataset.workspaceCategory,
                            referenceLabel: actionEl.dataset.workspaceReferenceLabel,
                            referenceValue: actionEl.dataset.workspaceReferenceValue,
                            targetId: actionEl.dataset.workspaceTargetId,
                            userId: actionEl.dataset.workspaceUserId,
                            clientIp: actionEl.dataset.workspaceClientIp,
                            discountCode: actionEl.dataset.workspaceDiscountCode,
                            signalType: actionEl.dataset.workspaceSignalType,
                            caseStatus: actionEl.dataset.workspaceCaseStatus,
                            caseOwnerAdminId: actionEl.dataset.workspaceCaseOwnerAdminId,
                            caseOwnerLabel: actionEl.dataset.workspaceCaseOwnerLabel
                        })
                );
                break;
            case 'settings-handle-shop-risk-case':
                window.handleShopRiskCaseAction?.(
                    actionEl.dataset.shopRiskCaseAction,
                    (typeof window.readOpsAlertWorkspaceContextDataset === 'function'
                        ? window.readOpsAlertWorkspaceContextDataset(actionEl.dataset)
                        : {
                            title: actionEl.dataset.workspaceTitle,
                            alertType: actionEl.dataset.workspaceAlertType,
                            category: actionEl.dataset.workspaceCategory,
                            referenceLabel: actionEl.dataset.workspaceReferenceLabel,
                            referenceValue: actionEl.dataset.workspaceReferenceValue,
                            targetId: actionEl.dataset.workspaceTargetId,
                            userId: actionEl.dataset.workspaceUserId,
                            clientIp: actionEl.dataset.workspaceClientIp,
                            discountCode: actionEl.dataset.workspaceDiscountCode,
                            signalType: actionEl.dataset.workspaceSignalType,
                            caseStatus: actionEl.dataset.workspaceCaseStatus,
                            caseOwnerAdminId: actionEl.dataset.workspaceCaseOwnerAdminId,
                            caseOwnerLabel: actionEl.dataset.workspaceCaseOwnerLabel
                        })
                );
                break;
            case 'settings-handle-ops-alert-case-action':
                window.handleOpsAlertCaseAction?.(
                    actionEl.dataset.opsAlertCaseAction,
                    (typeof window.readOpsAlertWorkspaceContextDataset === 'function'
                        ? window.readOpsAlertWorkspaceContextDataset(actionEl.dataset)
                        : {
                            title: actionEl.dataset.workspaceTitle,
                            alertType: actionEl.dataset.workspaceAlertType,
                            category: actionEl.dataset.workspaceCategory,
                            referenceLabel: actionEl.dataset.workspaceReferenceLabel,
                            referenceValue: actionEl.dataset.workspaceReferenceValue,
                            targetId: actionEl.dataset.workspaceTargetId,
                            userId: actionEl.dataset.workspaceUserId,
                            clientIp: actionEl.dataset.workspaceClientIp,
                            discountCode: actionEl.dataset.workspaceDiscountCode,
                            signalType: actionEl.dataset.workspaceSignalType,
                            caseStatus: actionEl.dataset.workspaceCaseStatus,
                            caseOwnerAdminId: actionEl.dataset.workspaceCaseOwnerAdminId,
                            caseOwnerLabel: actionEl.dataset.workspaceCaseOwnerLabel
                        })
                );
                break;
            case 'settings-close-shop-risk-case-modal':
                window.closeShopRiskCaseComposer?.();
                break;
            case 'settings-submit-shop-risk-case-modal':
                window.submitShopRiskCaseComposer?.();
                break;
            case 'settings-refresh-ops-alert-monitor':
                window.refreshOpsAlertMonitorPanel?.();
                break;
            case 'settings-batch-claim-ops-alert-monitor':
                window.handleOpsAlertMonitorBatchCaseAction?.('assign');
                break;
            case 'settings-batch-note-ops-alert-monitor':
                window.handleOpsAlertMonitorBatchCaseAction?.('add_note');
                break;
            case 'settings-batch-resolve-ops-alert-monitor':
                window.handleOpsAlertMonitorBatchCaseAction?.('resolve');
                break;
            case 'settings-batch-mute-ops-alert-monitor':
                window.openOpsAlertBatchMuteModal?.();
                break;
            case 'settings-toggle-ops-alert-batch-mute-allow-critical':
                window.toggleOpsAlertBatchMuteAllowCritical?.();
                break;
            case 'settings-close-ops-alert-batch-mute-modal':
                window.closeOpsAlertBatchMuteModal?.();
                break;
            case 'settings-submit-ops-alert-batch-mute-modal':
                window.submitOpsAlertBatchMuteModal?.();
                break;
            case 'settings-copy-ops-alert-monitor-checklist':
                window.copyOpsAlertMonitorChecklist?.();
                break;
            case 'settings-export-ops-alert-monitor-csv':
                window.exportOpsAlertMonitorCsv?.();
                break;
            case 'settings-copy-ops-alert-shift-report':
                window.copyOpsAlertMonitorShiftReportSummary?.();
                break;
            case 'settings-export-ops-alert-shift-report-csv':
                window.exportOpsAlertMonitorShiftReportCsv?.();
                break;
            case 'settings-set-ops-alert-shift-report-view':
                window.setOpsAlertMonitorShiftReportView?.(actionEl.dataset.opsAlertShiftReportView);
                break;
            case 'settings-copy-ops-alert-monitor-category':
                window.copyOpsAlertMonitorChecklist?.(actionEl.dataset.opsAlertMonitorCategoryKey);
                break;
            case 'settings-delete-ops-alert-secret':
                window.deleteOpsAlertSecret?.(actionEl.dataset.secretName);
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
            case 'homepage-remove-featured-prompt':
                window.HomepageAdmin?.removeFeaturedPrompt?.(decodeURIComponent(actionEl.dataset.homepagePromptId || ''));
                break;
            case 'homepage-move-featured-prompt':
                window.HomepageAdmin?.moveFeaturedPrompt?.(
                    decodeURIComponent(actionEl.dataset.homepagePromptId || ''),
                    actionEl.dataset.homepageDirection || ''
                );
                break;
            case 'homepage-open-featured-gallery':
                window.openAdminGalleryPromptContext?.(
                    decodeURIComponent(actionEl.dataset.homepagePromptId || ''),
                    { ensureModule: true }
                );
                break;
            case 'homepage-open-featured-comments':
                window.openAdminPromptCommentContext?.({
                    promptId: decodeURIComponent(actionEl.dataset.homepagePromptId || ''),
                    promptTitle: decodeURIComponent(actionEl.dataset.homepagePromptTitle || '')
                });
                break;
            case 'homepage-open-featured-analytics':
                window.switchModule?.('growth-center', {
                    analyticsTab: 'content',
                    analyticsPromptId: decodeURIComponent(actionEl.dataset.homepagePromptId || '')
                });
                break;
            case 'homepage-toggle-config-card':
                window.toggleConfigCard?.(actionEl);
                break;
            case 'settings-toggle-config-card':
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
            case 'payments-focus-exception-topic':
                window.AdminPayments?.focusExceptionTopic?.(actionEl.dataset.paymentsTopicKey);
                break;
            case 'payments-focus-ops-alert-queue':
                window.AdminPayments?.focusOpsAlertQueue?.();
                break;
            case 'payments-issue-summary-focus':
                window.AdminPayments?.focusAnalyticsIssueSummary?.(actionEl.dataset.paymentsIssueFocus);
                break;
            case 'payments-priority-focus-order':
                window.AdminPayments?.focusAnalyticsPrioritySummary?.('order', actionEl.dataset.paymentsOrderId);
                break;
            case 'payments-priority-focus-topic':
                window.AdminPayments?.focusAnalyticsPrioritySummary?.('topic', actionEl.dataset.paymentsTopicKey);
                break;
            case 'payments-priority-focus-ops':
                window.AdminPayments?.focusAnalyticsPrioritySummary?.('ops');
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
            case 'analytics-toggle-advanced-tools':
                window.toggleAnalyticsAdvancedTools?.();
                break;
            case 'analytics-view-context':
                window.viewPromptContext?.(actionEl.dataset.promptId);
                break;
            case 'analytics-open-prompt-gallery':
                window.openAdminGalleryPromptContext?.(
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    { ensureModule: true }
                );
                break;
            case 'analytics-open-prompt-comments':
                window.openAdminPromptCommentContext?.({
                    promptId: decodeURIComponent(actionEl.dataset.promptId || ''),
                    promptTitle: decodeURIComponent(actionEl.dataset.promptTitle || '')
                });
                break;
            case 'analytics-open-prompt-homepage':
                window.HomepageAdmin?.openPromptSectionContext?.(
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    { ensureModule: true }
                );
                break;
            case 'analytics-open-content-commerce-detail':
                window.openAnalyticsContentCommerceDetail?.(
                    actionEl.dataset.promptId,
                    {
                        promptTitle: actionEl.dataset.promptTitle || '',
                        focus: true
                    }
                );
                break;
            case 'analytics-open-user-detail': {
                const userId = decodeURIComponent(actionEl.dataset.userId || '');
                const analyticsContext = typeof parseAnalyticsActionContext === 'function'
                    ? parseAnalyticsActionContext(actionEl.dataset.analyticsContext || '')
                    : {};
                if (!userId) {
                    break;
                }

                if (typeof window.tryOpenOpsAlertWorkspaceUserModal === 'function') {
                    void window.tryOpenOpsAlertWorkspaceUserModal(userId, {
                        notifyDenied: true,
                        analyticsContext
                    });
                    break;
                }

                window.switchModule?.('users');
                setTimeout(() => {
                    window.openUserModal?.(userId, {
                        analyticsContext
                    });
                }, 0);
                break;
            }
            case 'analytics-open-destination':
                window.openAnalyticsDestination?.(
                    actionEl.dataset.analyticsDestination,
                    actionEl.dataset.analyticsContext || ''
                );
                break;
            case 'analytics-load-ai-prediction':
                window.loadAIPrediction?.();
                break;
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
            case 'users-toggle-admin-expiry-filter':
                window.toggleUserAdminExpiryFilter?.();
                break;
            case 'users-filter-admin-expiry':
                window.filterUserByAdminExpiry?.(actionEl.dataset.userAdminExpiry);
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
            case 'users-batch-renew-admin':
                window.batchRenewAdminAccess?.();
                break;
            case 'users-batch-set-admin-expiry':
                window.batchSetAdminExpiry?.();
                break;
            case 'users-close-modal':
                window.closeUserModal?.();
                break;
            case 'users-open-analytics-destination': {
                const destination = String(actionEl.dataset.analyticsDestination || '').trim();
                const analyticsContext = typeof parseAnalyticsActionContext === 'function'
                    ? parseAnalyticsActionContext(actionEl.dataset.analyticsContext || '')
                    : {};
                void (async () => {
                    if (typeof window.closeUserModal === 'function') {
                        const closed = await window.closeUserModal();
                        if (closed === false) {
                            return;
                        }
                    }
                    window.openAnalyticsDestination?.(destination, analyticsContext);
                })();
                break;
            }
            case 'users-open-comment-context': {
                const commentContext = {
                    view: String(actionEl.dataset.commentView || '').trim().toLowerCase(),
                    commentId: decodeURIComponent(actionEl.dataset.commentId || ''),
                    promptId: decodeURIComponent(actionEl.dataset.promptId || ''),
                    promptTitle: decodeURIComponent(actionEl.dataset.promptTitle || '')
                };
                void (async () => {
                    if (typeof window.closeUserModal === 'function') {
                        const closed = await window.closeUserModal();
                        if (closed === false) {
                            return;
                        }
                    }
                    window.openAdminUserCommentContext?.(commentContext);
                })();
                break;
            }
            case 'users-switch-tab':
                window.switchUserTab?.(actionEl.dataset.userTab);
                break;
            case 'users-reload-tab':
                window.reloadUserModalTab?.(actionEl.dataset.userTab);
                break;
            case 'users-open-drawer':
                window.openUserDrawer?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-stop-propagation':
                event.stopPropagation();
                break;
            case 'users-copy-meta': {
                const copyValue = decodeURIComponent(actionEl.dataset.copyValue || '');
                if (!copyValue || !navigator?.clipboard?.writeText) {
                    break;
                }

                navigator.clipboard.writeText(copyValue).then(() => {
                    const originalTooltip = actionEl.getAttribute('data-tooltip') || '';
                    const successTooltip = actionEl.dataset.copySuccess || '已复制';
                    actionEl.setAttribute('data-tooltip', successTooltip);
                    setTimeout(() => actionEl.setAttribute('data-tooltip', originalTooltip), 2000);
                }).catch((error) => {
                    console.warn('Failed to copy user metadata', error);
                });
                break;
            }
            case 'users-show-tag-input':
                window.showTagInput?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-remove-tag':
                window.removeUserTag?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    decodeURIComponent(actionEl.dataset.userTag || '')
                );
                break;
            case 'users-save-modal-admin-permissions':
                window.saveModalAdminPermissions?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-apply-permission-template':
                window.applyModalAdminPermissionTemplate?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl.dataset.adminPermissionTemplateId || ''
                );
                break;
            case 'users-toggle-block':
                window.toggleUserBlock?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl.dataset.userBanned === '1'
                );
                break;
            case 'users-adjust-points':
                window.adjustUserPoints?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-reset-avatar':
                window.resetUserAvatar?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-clear-content':
                window.clearAllUserContent?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-show-notification':
                window.showNotificationModal?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-toggle-modal-dropdown':
                window.toggleModalDropdown?.(actionEl.dataset.dropdownId);
                break;
            case 'users-filter-tab-date':
                window.filterTabByDate?.(
                    actionEl.dataset.userTabName,
                    actionEl.dataset.userDateRange,
                    actionEl.dataset.userDateLabel
                );
                break;
            case 'users-open-custom-date-picker':
                window.openCustomDatePicker?.(actionEl.dataset.userTabName);
                break;
            case 'users-export-tab-data':
                window.exportTabData?.(actionEl.dataset.userTabName);
                break;
            case 'users-open-ledger-detail':
                window.openAdminLedgerDetail?.(decodeURIComponent(actionEl.dataset.ledgerId || ''));
                break;
            case 'users-close-ledger-detail':
                window.closeAdminLedgerDetailModal?.();
                break;
            case 'users-open-user-modal':
                window.openUserModal?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-reload-affiliate':
                window.reloadAffiliateModalData?.();
                break;
            case 'users-submit-note':
                window.submitUserNote?.();
                break;
            case 'users-close-notification-modal':
                window.closeNotificationModal?.();
                break;
            case 'users-select-notification-type':
                window.selectNotifType?.(actionEl.dataset.notificationType);
                break;
            case 'users-send-notification':
                window.sendSystemNotification?.(decodeURIComponent(actionEl.dataset.userId || ''));
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
            case 'settings-clean-empty-verify-keys':
                window.cleanZeroBalanceVerifyKeys?.();
                break;
            case 'settings-refresh-verify-monitor':
                window.refreshVerifyMonitor?.();
                break;
            case 'settings-change-verify-monitor-task-page': {
                const page = parseInt(actionEl.dataset.verifyMonitorPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.changeVerifyMonitorTaskPage?.(page);
                }
                break;
            }
            case 'settings-change-verify-monitor-failure-page': {
                const page = parseInt(actionEl.dataset.verifyMonitorPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.changeVerifyMonitorFailurePage?.(page);
                }
                break;
            }
            case 'settings-refresh-admin-audit-monitor':
                window.refreshAdminAuditMonitor?.();
                break;
            case 'settings-change-admin-audit-access-page': {
                const page = parseInt(actionEl.dataset.adminAuditPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.changeAdminAuditMonitorAccessPage?.(page);
                }
                break;
            }
            case 'settings-change-admin-audit-anomaly-page': {
                const page = parseInt(actionEl.dataset.adminAuditPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.changeAdminAuditMonitorAnomalyPage?.(page);
                }
                break;
            }
            case 'settings-change-admin-audit-config-page': {
                const page = parseInt(actionEl.dataset.adminAuditPage || '', 10);
                if (!Number.isNaN(page)) {
                    window.changeAdminAuditMonitorConfigPage?.(page);
                }
                break;
            }
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
            case 'discounts-export-filtered-audit-summaries':
                void window.AdminDiscounts?.exportFilteredAuditSummaries?.();
                break;
            case 'discounts-open-batch-restore-history-modal':
                void window.AdminDiscounts?.openBatchRestoreHistoryModal?.();
                break;
            case 'discounts-set-batch-history-filter':
                window.AdminDiscounts?.setBatchRestoreHistoryFilter?.(actionEl.dataset.discountHistoryFilter || '');
                break;
            case 'discounts-open-history-run-detail':
                window.AdminDiscounts?.openBatchRestoreHistoryRunDetail?.(actionEl.dataset.discountBatchRunId || '');
                break;
            case 'discounts-open-batch-restore-modal':
                window.AdminDiscounts?.openBatchRestoreModal?.();
                break;
            case 'discounts-close-batch-restore-result-modal':
                window.AdminDiscounts?.closeBatchRestoreResultModal?.();
                break;
            case 'discounts-close-batch-restore-history-modal':
                window.AdminDiscounts?.closeBatchRestoreHistoryModal?.();
                break;
            case 'discounts-close-history-run-detail':
                window.AdminDiscounts?.closeBatchRestoreHistoryRunDetail?.();
                break;
            case 'discounts-refresh-batch-restore-history':
                void window.AdminDiscounts?.loadBatchRestoreHistory?.({ force: true });
                break;
            case 'discounts-copy-batch-restore-result-summary':
                void window.AdminDiscounts?.copyBatchRestoreSummary?.();
                break;
            case 'discounts-export-batch-restore-result-summary':
                window.AdminDiscounts?.exportBatchRestoreSummary?.();
                break;
            case 'discounts-copy-batch-restore-failed-summary':
                void window.AdminDiscounts?.copyBatchRestoreFailedSummary?.();
                break;
            case 'discounts-export-batch-restore-failed-summary':
                window.AdminDiscounts?.exportBatchRestoreFailedSummary?.();
                break;
            case 'discounts-copy-history-run-summary':
                void window.AdminDiscounts?.copyBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'all');
                break;
            case 'discounts-export-history-run-summary':
                window.AdminDiscounts?.exportBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'all');
                break;
            case 'discounts-copy-history-run-failed-summary':
                void window.AdminDiscounts?.copyBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'failed');
                break;
            case 'discounts-export-history-run-failed-summary':
                window.AdminDiscounts?.exportBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'failed');
                break;
            case 'discounts-retry-history-run':
                void window.AdminDiscounts?.retryBatchRestoreHistoryRun?.(actionEl.dataset.discountBatchRunId || '');
                break;
            case 'discounts-retry-history-run-item':
                void window.AdminDiscounts?.retryBatchRestoreHistoryRun?.(
                    actionEl.dataset.discountBatchRunId || '',
                    { discountId: actionEl.dataset.discountId || '' }
                );
                break;
            case 'discounts-open-detail-by-reference':
                void window.AdminDiscounts?.openDetailByReference?.({
                    id: actionEl.dataset.discountId || '',
                    code: actionEl.dataset.discountCode || ''
                });
                break;
            case 'discounts-open-detail-modal':
                window.AdminDiscounts?.openDetailModal?.(actionEl.dataset.discountId || '');
                break;
            case 'discounts-open-restore-modal':
                window.AdminDiscounts?.openRestoreModal?.(actionEl.dataset.discountId || '');
                break;
            case 'discounts-open-edit-modal':
                window.AdminDiscounts?.openEditModal?.(actionEl.dataset.discountId || '');
                break;
            case 'discounts-open-edit-from-detail':
                void window.AdminDiscounts?.openEditFromDetail?.(actionEl.dataset.discountId || '');
                break;
            case 'discounts-assign-assets':
                void window.AdminDiscounts?.assignAssetsFromDetail?.(actionEl.dataset.discountId || '');
                break;
            case 'discounts-copy-code':
                window.AdminDiscounts?.copyCode?.(actionEl.dataset.discountCode || '');
                break;
            case 'discounts-copy-audit-summary':
                void window.AdminDiscounts?.copyAuditSummary?.();
                break;
            case 'discounts-export-audit-summary':
                window.AdminDiscounts?.exportAuditSummary?.();
                break;
            case 'discounts-clear-workbench-context':
                window.AdminDiscounts?.clearWorkbenchContext?.();
                break;
            case 'discounts-close-detail-modal':
                window.AdminDiscounts?.closeDetailModal?.();
                break;
            case 'discounts-set-timeline-filter':
                window.AdminDiscounts?.setDetailTimelineFilter?.(actionEl.dataset.discountTimelineFilter || '');
                break;
            case 'discounts-close-restore-modal':
                window.AdminDiscounts?.closeRestoreModal?.();
                break;
            case 'discounts-close-batch-restore-modal':
                window.AdminDiscounts?.closeBatchRestoreModal?.();
                break;
            case 'discounts-open-related-order':
                void window.AdminDiscounts?.openRelatedOrder?.(actionEl.dataset.orderId || '');
                break;
            case 'discounts-submit-restore-modal':
                void window.AdminDiscounts?.submitRestoreModal?.();
                break;
            case 'discounts-submit-batch-restore-modal':
                void window.AdminDiscounts?.submitBatchRestoreModal?.();
                break;
            case 'discounts-retry-batch-restore-failures':
                void window.AdminDiscounts?.retryBatchRestoreFailures?.();
                break;
            case 'discounts-skip-batch-restore-item':
                window.AdminDiscounts?.skipBatchRestoreResultItem?.(actionEl.dataset.discountId || '');
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
            case 'tickets-switch-workspace':
                window.AdminTickets?.setWorkspaceView?.(actionEl.dataset.ticketWorkspace, {
                    scroll: false,
                    highlight: false
                });
                break;
            case 'tickets-toggle-overdue':
                window.AdminTickets?.toggleQuickFilter?.('overdue');
                break;
            case 'tickets-toggle-priority':
                window.AdminTickets?.toggleQuickFilter?.('priority');
                break;
            case 'tickets-toggle-mine':
                window.AdminTickets?.toggleQuickFilter?.('mine');
                break;
            case 'tickets-toggle-unassigned':
                window.AdminTickets?.toggleQuickFilter?.('unassigned');
                break;
            case 'tickets-issue-summary-focus':
                window.AdminTickets?.focusAnalyticsIssueSummary?.(actionEl.dataset.ticketIssueFocus);
                break;
            case 'tickets-priority-open':
                window.AdminTickets?.focusAnalyticsPrioritySummary?.('open', actionEl.dataset.ticketId);
                break;
            case 'tickets-priority-resolve':
                window.AdminTickets?.focusAnalyticsPrioritySummary?.('resolve', actionEl.dataset.ticketId);
                break;
            case 'tickets-priority-reject':
                window.AdminTickets?.focusAnalyticsPrioritySummary?.('reject', actionEl.dataset.ticketId);
                break;
            case 'tickets-toggle-select-mode':
                window.AdminTickets?.toggleSelectionMode?.();
                break;
            case 'tickets-toggle-batch-menu':
                window.AdminTickets?.toggleBatchMenu?.();
                break;
            case 'tickets-select-all-page':
                window.AdminTickets?.selectAllCurrentPage?.();
                break;
            case 'tickets-open-overdue-queue':
                window.AdminTickets?.openOverdueQueue?.();
                break;
            case 'tickets-open-sla-settings':
                window.AdminTickets?.openSlaSettings?.();
                break;
            case 'tickets-open-sla-summary-settings':
                window.AdminTickets?.openSlaSummarySettings?.();
                break;
            case 'tickets-open-summary-job-detail':
                window.AdminTickets?.openReminderSummaryJobDetail?.(actionEl.dataset.summaryJobId);
                break;
            case 'tickets-close-summary-job-detail':
                window.AdminTickets?.closeReminderSummaryJobDetail?.();
                break;
            case 'tickets-save-summary-job-note':
                window.AdminTickets?.submitReminderSummaryNote?.(actionEl.dataset.summaryJobId);
                break;
            case 'tickets-retry-summary-job':
                window.AdminTickets?.submitReminderSummaryRetry?.(actionEl.dataset.summaryJobId);
                break;
            case 'tickets-refresh-overview':
                window.AdminTickets?.refreshOverview?.();
                break;
            case 'tickets-open-reminder-ticket':
                window.AdminTickets?.openReminderTicket?.(actionEl.dataset.ticketId);
                break;
            case 'tickets-bulk-assign-self':
                window.AdminTickets?.submitBulkAssignment?.('assign_self');
                break;
            case 'tickets-bulk-clear-assignee':
                window.AdminTickets?.submitBulkAssignment?.('clear');
                break;
            case 'tickets-open-bulk-resolve':
                window.AdminTickets?.openBulkProcessModal?.('RESOLVED');
                break;
            case 'tickets-open-bulk-reject':
                window.AdminTickets?.openBulkProcessModal?.('REJECTED');
                break;
            case 'tickets-close-bulk-process-modal':
                window.AdminTickets?.closeBulkProcessModal?.();
                break;
            case 'tickets-submit-bulk-process':
                window.AdminTickets?.submitBulkProcess?.();
                break;
            case 'tickets-clear-selection':
                window.AdminTickets?.clearSelectedTickets?.();
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
            case 'comments-pagination-go': {
                const max = Math.max(1, parseInt(actionEl.dataset.commentsPageMax || '1', 10) || 1);
                const nextPage = Math.min(Math.max(parseInt(actionEl.value || '', 10) || 1, 1), max);
                actionEl.value = String(nextPage);
                window.changeCommentsPage?.(nextPage);
                break;
            }
            case 'gallery-pagination-go': {
                const max = Math.max(1, parseInt(actionEl.dataset.galleryPageMax || '1', 10) || 1);
                const nextPage = Math.min(Math.max(parseInt(actionEl.value || '', 10) || 1, 1), max);
                actionEl.value = String(nextPage);
                window.changeAdminGalleryPage?.(nextPage);
                break;
            }
            case 'payments-change-active-provider':
                window.handlePaymentChannelActiveChange?.(actionEl.value);
                break;
            case 'settings-change-ops-alert-customer-chat-message-summary-schedule-mode':
                window.handleOpsAlertCustomerChatMessageSummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-shop-inventory-summary-schedule-mode':
                window.handleOpsAlertShopInventorySummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-shop-purchase-success-summary-schedule-mode':
                window.handleOpsAlertShopPurchaseSuccessSummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-wallet-recharge-success-summary-schedule-mode':
                window.handleOpsAlertWalletRechargeSuccessSummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-tickets-summary-schedule-mode':
                window.handleOpsAlertTicketsSummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-shop-order-delivery-summary-schedule-mode':
                window.handleOpsAlertShopOrderDeliverySummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-verify-quota-summary-schedule-mode':
                window.handleOpsAlertVerifyQuotaSummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-verify-queue-summary-schedule-mode':
                window.handleOpsAlertVerifyQueueSummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-verify-failure-summary-schedule-mode':
                window.handleOpsAlertVerifyFailureSummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-payment-gateway-summary-schedule-mode':
                window.handleOpsAlertPaymentGatewaySummaryScheduleModeChange?.();
                break;
            case 'settings-change-ops-alert-unified-summary-target':
                window.handleOpsAlertUnifiedSummaryTargetChange?.();
                break;
            case 'settings-change-ops-alert-unified-summary-draft':
                window.handleOpsAlertUnifiedSummaryDraftChange?.();
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
            case 'users-toggle-select-all-page':
                window.toggleSelectAllPage?.();
                break;
            case 'users-toggle-selection':
                window.toggleUserSelection?.(decodeURIComponent(actionEl.dataset.userId || ''));
                break;
            case 'users-toggle-modal-admin':
                window.handleModalAdminToggle?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl.checked
                );
                break;
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
            case 'tickets-toggle-select-all-page':
                window.AdminTickets?.toggleSelectAllPage?.(Boolean(actionEl.checked));
                break;
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
            case 'discounts-search-batch-history':
                window.AdminDiscounts?.searchBatchRestoreHistory?.();
                break;
            case 'discounts-format-expiry-date':
            case 'discounts-format-start-date':
                window.AdminDiscounts?.formatExpiryDateInput?.(actionEl);
                break;
            case 'discounts-format-expiry-time':
            case 'discounts-format-start-time':
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

        if (!guardAdminStudioWritableForm(form, event)) {
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

        if (form.id === 'shopRiskCaseComposerForm') {
            event.preventDefault();
            window.submitShopRiskCaseComposer?.();
            return;
        }

        if (form.id === 'opsAlertBatchMuteForm') {
            event.preventDefault();
            window.submitOpsAlertBatchMuteModal?.();
        }
    });

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const overlay = target.closest('[data-admin-overlay-close]');
        if (!(overlay instanceof HTMLElement)) {
            return;
        }

        if (overlay.dataset.adminOverlayClose === 'ticket-reply-modal' && target.closest('.admin-ticket-reply-modal__panel')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'ticket-bulk-process-modal' && target.closest('.admin-ticket-bulk-modal__panel')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'ticket-summary-job-detail-modal' && target.closest('.admin-ticket-summary-job-modal__dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'user-modal' && target.closest('#userModal')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'discount-generate-modal' && target.closest('.admin-discount-form-modal__dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'discount-detail-modal' && target.closest('.admin-discount-detail-dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'discount-restore-modal' && target.closest('.admin-discount-restore-dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'discount-batch-restore-modal' && target.closest('.admin-discount-restore-dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'discount-batch-restore-result-modal' && target.closest('.admin-discount-restore-dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'discount-batch-restore-history-modal' && target.closest('.admin-discount-restore-dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'discount-batch-restore-history-run-detail-modal' && target.closest('.admin-discount-restore-dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'shop-risk-case-modal' && target.closest('.admin-shop-risk-case-modal__dialog')) {
            return;
        }
        if (overlay.dataset.adminOverlayClose === 'ops-alert-batch-mute-modal' && target.closest('.admin-shop-risk-case-modal__dialog')) {
            return;
        }

        switch (overlay.dataset.adminOverlayClose) {
            case 'discount-generate-modal':
                window.AdminDiscounts?.closeGenerateModal?.();
                break;
            case 'discount-detail-modal':
                window.AdminDiscounts?.closeDetailModal?.();
                break;
            case 'discount-restore-modal':
                window.AdminDiscounts?.closeRestoreModal?.();
                break;
            case 'discount-batch-restore-modal':
                window.AdminDiscounts?.closeBatchRestoreModal?.();
                break;
            case 'discount-batch-restore-result-modal':
                window.AdminDiscounts?.closeBatchRestoreResultModal?.();
                break;
            case 'discount-batch-restore-history-modal':
                window.AdminDiscounts?.closeBatchRestoreHistoryModal?.();
                break;
            case 'discount-batch-restore-history-run-detail-modal':
                window.AdminDiscounts?.closeBatchRestoreHistoryRunDetail?.();
                break;
            case 'ticket-reply-modal':
                window.AdminTickets?.closeReplyModal?.();
                break;
            case 'ticket-bulk-process-modal':
                window.AdminTickets?.closeBulkProcessModal?.();
                break;
            case 'ticket-summary-job-detail-modal':
                window.AdminTickets?.closeReminderSummaryJobDetail?.();
                break;
            case 'shop-risk-case-modal':
                window.closeShopRiskCaseComposer?.();
                break;
            case 'ops-alert-batch-mute-modal':
                window.closeOpsAlertBatchMuteModal?.();
                break;
            case 'delete-confirm-modal':
                hideDeleteConfirmation();
                break;
            case 'crop-modal':
                closeCropModal();
                break;
            case 'user-modal':
                window.closeUserModal?.();
                break;
            case 'inventory-release-modal':
                window.ShopAdmin?.closeReleaseModal?.();
                break;
            case 'inventory-import-modal':
                window.ShopAdmin?.closeImportModal?.();
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
let currentEditingPromptAiTags = null;

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
    if (manageTab) {
        manageTab.hidden = !hasPermission('prompts.manage') && !hasPermission('content.moderate');
    }

    window.syncAdminStudioModuleAccess?.({
        preferredModule: window.restoreAdminStudioModuleFromUrl?.(),
        enforceActiveModule: true
    });

    // Additional UI updates can be handled by respective modules listening to 'permissionsLoaded'
}

// ========================================
// VIEW SWITCHING
// ========================================
const OPS_ALERTS_MODULE_VIEW_CARD_ASSIGNMENTS = Object.freeze([
    { configId: 'ops-alerts-overview', bucket: 'overview-main' },
    { configId: 'ops-alerts-strategy', bucket: 'strategy-main' },
    { configId: 'ops-alerts-summary-orchestration', bucket: 'strategy-side' },
    { configId: 'ops-alerts-actions', bucket: 'channels-main' },
    { configId: 'ops-alerts-telegram', bucket: 'channels-side' },
    { configId: 'ops-alerts-feishu', bucket: 'channels-side' },
    { configId: 'ops-alerts-email', bucket: 'channels-side' },
    { configId: 'ops-alerts-customer-chat-message', bucket: 'monitors-main' },
    { configId: 'ops-alerts-wallet-recharge-success', bucket: 'monitors-main' },
    { configId: 'ops-alerts-shop-inventory', bucket: 'monitors-main' },
    { configId: 'ops-alerts-tickets', bucket: 'monitors-main' },
    { configId: 'ops-alerts-payment-gateway', bucket: 'monitors-main' },
    { configId: 'ops-alerts-verify-queue', bucket: 'monitors-main' },
    { configId: 'ops-alerts-shop-purchase-success', bucket: 'monitors-side' },
    { configId: 'ops-alerts-shop-order-delivery', bucket: 'monitors-side' },
    { configId: 'ops-alerts-verify-quota', bucket: 'monitors-side' },
    { configId: 'ops-alerts-verify-failure', bucket: 'monitors-side' },
    { configId: 'ops-alerts-shop-risk', bucket: 'monitors-side' },
    { configId: 'ops-alerts-workspace', bucket: 'workspace-main' },
    { configId: 'ops-alerts-monitor', bucket: 'workspace-side' },
    { configId: 'ops-alerts-health', bucket: 'health-main' }
]);

function organizeOpsAlertsModule() {
    const legacySource = document.getElementById('opsAlertsLegacySource');
    const opsAlertsModule = document.getElementById('module-ops-alerts');
    if (!legacySource || !opsAlertsModule) return;
    if (opsAlertsModule.dataset.layoutReady === '1') return;

    for (const assignment of OPS_ALERTS_MODULE_VIEW_CARD_ASSIGNMENTS) {
        const card = legacySource.querySelector(`[data-config="${assignment.configId}"]`);
        const bucket = opsAlertsModule.querySelector(`[data-ops-alerts-bucket="${assignment.bucket}"]`);
        if (!card || !bucket) continue;
        bucket.appendChild(card);
    }

    opsAlertsModule.dataset.layoutReady = '1';
}

// Switch between Create and Manage views
function switchView(viewName) {
    const galleryModule = document.getElementById('module-gallery');
    if (!galleryModule) return;
    const normalizedView = viewName === 'manage' ? 'manage' : 'create';

    // Update active tab buttons
    galleryModule.querySelectorAll('.admin-tab[data-view]').forEach(tab => {
        const isActive = tab.dataset.view === normalizedView;
        tab.classList.toggle('active', isActive);

        // Update sliding indicator position
        if (isActive) {
            updateAdminTabIndicator(tab);
        }
    });

    // Update view visibility
    galleryModule.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    const targetView = galleryModule.querySelector(`#view-${normalizedView}`);
    if (targetView) {
        targetView.classList.add('active');
    }

    syncAdminGalleryRouteState({
        view: normalizedView,
        promptId: normalizedView === 'manage'
            ? (pendingAdminGalleryFocusPromptId || getAdminGalleryRouteState().promptId || '')
            : ''
    });

    // Load data if switching to Manage view
    if (normalizedView === 'manage') {
        renderGallerySiteContextBanner();
        loadAdminPrompts({ allowCached: true });
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

window.switchSettingsView = switchSettingsView;

function switchOpsAlertsView(viewName) {
    const opsAlertsModule = document.getElementById('module-ops-alerts');
    if (!opsAlertsModule) return;

    organizeOpsAlertsModule();

    const activeTab = opsAlertsModule.querySelector('.admin-tab[data-ops-alerts-view].active');
    const currentViewName = activeTab?.dataset.opsAlertsView || '';
    if (viewName !== currentViewName && window.confirmOpsAlertStrategyNavigation?.(currentViewName, viewName) === false) {
        return;
    }

    opsAlertsModule.querySelectorAll('.admin-tab[data-ops-alerts-view]').forEach(tab => {
        const isActive = tab.dataset.opsAlertsView === viewName;
        tab.classList.toggle('active', isActive);

        if (isActive) {
            updateAdminTabIndicator(tab);
        }
    });

    opsAlertsModule.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    const targetView = document.getElementById(`ops-alerts-view-${viewName}`);
    if (targetView) {
        targetView.classList.add('active');
    }
}

window.switchOpsAlertsView = switchOpsAlertsView;

function initOpsAlertsModule() {
    organizeOpsAlertsModule();

    const opsAlertsModule = document.getElementById('module-ops-alerts');
    if (!opsAlertsModule) return;

    const activeTab = opsAlertsModule.querySelector('.admin-tab[data-ops-alerts-view].active');
    switchOpsAlertsView(activeTab?.dataset.opsAlertsView || 'overview');
}

initOpsAlertsModule();

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
}

// ========================================
// LOAD ADMIN PROMPTS
// ========================================
let allPrompts = []; // Cache all prompts for local search
const ADMIN_GALLERY_PAGE_SIZE = 10;
const adminGalleryPrefetchState = {
    site: '',
    loaded: false,
    promise: null
};
const adminGalleryLoadState = {
    site: '',
    loaded: false,
    loadedAt: 0,
    promise: null,
    requestId: 0
};
const adminGalleryViewState = {
    page: 1,
    pageSize: ADMIN_GALLERY_PAGE_SIZE,
    searchQuery: '',
    searchMatchedIds: null,
    sortValue: 'updated-desc'
};
let pendingAdminGalleryFocusPromptId = '';

function getGalleryActiveViewName() {
    return document.querySelector('#module-gallery .view-section.active')?.id === 'view-manage'
        ? 'manage'
        : 'create';
}

function isGalleryManageViewActive() {
    return getGalleryActiveViewName() === 'manage';
}

function normalizeAdminGallerySite(site = getAdminPromptsReadSite()) {
    const normalized = String(site || '').trim().toLowerCase();
    return normalized === 'cn' || normalized === 'intl' ? normalized : 'all';
}

function hasFreshAdminGalleryPromptList(site = getAdminPromptsReadSite()) {
    const normalizedSite = normalizeAdminGallerySite(site);
    if (!adminGalleryLoadState.loaded || adminGalleryLoadState.site !== normalizedSite) {
        return false;
    }

    return (Date.now() - adminGalleryLoadState.loadedAt) <= ADMIN_GALLERY_LIST_REFRESH_TTL_MS;
}

function markAdminGalleryPromptListLoaded(site = getAdminPromptsReadSite()) {
    adminGalleryLoadState.site = normalizeAdminGallerySite(site);
    adminGalleryLoadState.loaded = true;
    adminGalleryLoadState.loadedAt = Date.now();
}

function markAdminGalleryPromptListStale(site = '') {
    const normalizedSite = site ? normalizeAdminGallerySite(site) : '';
    if (!normalizedSite || adminGalleryLoadState.site === normalizedSite) {
        adminGalleryLoadState.loaded = false;
        adminGalleryLoadState.loadedAt = 0;
        if (!normalizedSite) {
            adminGalleryLoadState.site = '';
        }
    }
}

function setAdminGalleryFilterDropdownValue(dropdownId, value = '') {
    if (typeof setCustomDropdownValue === 'function') {
        setCustomDropdownValue(dropdownId, value);
    }
}

function resetAdminGalleryManageFilters() {
    const searchInput = document.getElementById('adminSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }

    adminGalleryViewState.searchQuery = '';
    adminGalleryViewState.searchMatchedIds = null;
    adminGalleryViewState.sortValue = 'updated-desc';
    setAdminGalleryFilterDropdownValue('categoryFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('dateFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('languageFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('statusFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('sortFilterDropdown', 'updated-desc');
}

function queueAdminGalleryPromptFocus(promptId = '') {
    pendingAdminGalleryFocusPromptId = String(promptId || '').trim();
}

function renderGallerySiteContextBanner(site = getAdminPromptsReadSite()) {
    const banner = document.getElementById('gallerySiteContextBanner');
    if (!banner) {
        return;
    }

    const normalizedSite = String(site || '').trim().toLowerCase() === 'intl' ? 'intl' : (String(site || '').trim().toLowerCase() === 'cn' ? 'cn' : 'all');
    if (normalizedSite === 'all') {
        banner.innerHTML = '<i class="fas fa-compass"></i><span>当前是全部站点视角：Prompt 仍是全局资产，卡片里的 CN / INTL 指标来自各站互动数据。切到 CN 或 EN 后才允许保存、删除、加首页等写操作。</span>';
        return;
    }

    const siteLabel = normalizedSite === 'intl' ? 'EN' : 'CN';
    banner.innerHTML = `<i class="fas fa-compass"></i><span>当前是 ${siteLabel} 站运营视角：你编辑的仍是同一份全局 Prompt 资产，但列表高亮、评论联动、首页精选写入和写权限都会落在该站点上下文。</span>`;
}

const PROMPT_ADMIN_STATUS_LABELS = Object.freeze({
    draft: '草稿',
    review: '待复核',
    'needs-localization': '待补双语',
    'homepage-candidate': '首页候选',
    featured: '已上首页',
    ready: '可发布',
    live: '已上线',
    archived: '已归档'
});

const ADMIN_GALLERY_SORT_LABELS = Object.freeze({
    'updated-desc': '最近更新',
    'created-desc': '最新创建',
    'engagement-desc': '互动最高',
    'status-priority': '运营优先',
    'title-asc': '标题排序'
});

const ADMIN_GALLERY_STATUS_PRIORITY = Object.freeze({
    review: 0,
    'homepage-candidate': 1,
    featured: 2,
    live: 3,
    'needs-localization': 4,
    ready: 5,
    draft: 6,
    archived: 7
});

function normalizePromptAdminOpsData(value = {}) {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalizedStatus = String(data.status || '').trim().toLowerCase();
    const allowedStatuses = new Set(Object.keys(PROMPT_ADMIN_STATUS_LABELS));

    return {
        status: allowedStatuses.has(normalizedStatus) ? normalizedStatus : '',
        note: String(data.note || '').trim()
    };
}

function getPromptAdminOpsData(prompt = {}) {
    const aiTags = prompt?.ai_tags && typeof prompt.ai_tags === 'object' && !Array.isArray(prompt.ai_tags)
        ? prompt.ai_tags
        : (prompt?.aiTags && typeof prompt.aiTags === 'object' && !Array.isArray(prompt.aiTags)
            ? prompt.aiTags
            : {});
    return normalizePromptAdminOpsData(aiTags.admin || aiTags.ops || {});
}

function getPromptHomepageFeatureState(promptId = '', site = getAdminPromptsReadSite()) {
    const normalizedPromptId = String(promptId || '').trim();
    const normalizedSite = String(site || '').trim().toLowerCase() === 'intl'
        ? 'intl'
        : (String(site || '').trim().toLowerCase() === 'cn' ? 'cn' : 'all');
    const featureSites = typeof window.HomepageAdmin?.getFeaturedPromptSites === 'function'
        ? window.HomepageAdmin.getFeaturedPromptSites(normalizedPromptId)
        : [];
    const uniqueSites = [...new Set(
        (Array.isArray(featureSites) ? featureSites : [])
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => item === 'cn' || item === 'intl')
    )];
    const currentSite = normalizedSite === 'all' ? false : uniqueSites.includes(normalizedSite);

    return {
        currentSite,
        anySite: uniqueSites.length > 0,
        sites: uniqueSites,
        label: uniqueSites.length > 0
            ? `首页精选 ${uniqueSites.map((item) => item === 'intl' ? 'EN' : 'CN').join(' / ')}`
            : ''
    };
}

function buildPromptAdminOpsSummary(prompt = {}) {
    const opsData = getPromptAdminOpsData(prompt);
    const featureState = getPromptHomepageFeatureState(prompt?.id || '');
    const parts = [];

    if (featureState.label) {
        parts.push(featureState.label);
    }
    if (opsData.note) {
        parts.push(opsData.note);
    }

    return parts.join(' · ');
}

function getPromptLifecycleState(prompt = {}) {
    const opsData = getPromptAdminOpsData(prompt);
    const featureState = getPromptHomepageFeatureState(prompt?.id || '');
    const coverage = getPromptLanguageCoverage(prompt);
    const metrics = normalizePromptSiteMetrics(prompt).total;
    const hasBaseTitle = promptHasVisibleCopy(prompt.title);
    const hasPromptText = promptHasVisibleCopy(prompt.prompt_text);
    const hasImages = Array.isArray(prompt.images) && prompt.images.some((value) => promptHasVisibleCopy(value));

    if (opsData.status === 'archived') {
        return {
            key: 'archived',
            label: PROMPT_ADMIN_STATUS_LABELS.archived
        };
    }

    if (opsData.status === 'draft') {
        return {
            key: 'draft',
            label: PROMPT_ADMIN_STATUS_LABELS.draft
        };
    }

    if (!hasBaseTitle || !hasPromptText || !hasImages) {
        return {
            key: 'draft',
            label: PROMPT_ADMIN_STATUS_LABELS.draft
        };
    }

    if (opsData.status === 'review') {
        return {
            key: 'review',
            label: PROMPT_ADMIN_STATUS_LABELS.review
        };
    }

    if (!coverage.zh || !coverage.en) {
        return {
            key: 'needs-localization',
            label: PROMPT_ADMIN_STATUS_LABELS['needs-localization']
        };
    }

    if (opsData.status === 'homepage-candidate') {
        return {
            key: 'homepage-candidate',
            label: PROMPT_ADMIN_STATUS_LABELS['homepage-candidate']
        };
    }

    if (opsData.status === 'featured' || featureState.anySite) {
        return {
            key: 'featured',
            label: PROMPT_ADMIN_STATUS_LABELS.featured
        };
    }

    if (metrics.unlock_count > 0 || metrics.comment_count > 0) {
        return {
            key: 'live',
            label: PROMPT_ADMIN_STATUS_LABELS.live
        };
    }

    return {
        key: opsData.status === 'live' ? 'live' : 'ready',
        label: opsData.status === 'live' ? PROMPT_ADMIN_STATUS_LABELS.live : PROMPT_ADMIN_STATUS_LABELS.ready
    };
}

function normalizeAdminGallerySortValue(value = '') {
    const normalizedValue = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(ADMIN_GALLERY_SORT_LABELS, normalizedValue)
        ? normalizedValue
        : 'updated-desc';
}

function setAdminGallerySortFilterValue(value = 'updated-desc') {
    const normalizedValue = normalizeAdminGallerySortValue(value);
    adminGalleryViewState.sortValue = normalizedValue;
    setAdminGalleryFilterDropdownValue('sortFilterDropdown', normalizedValue);
    return normalizedValue;
}

function setAdminGalleryStatusFilter(value = '') {
    setAdminGalleryFilterDropdownValue('statusFilterDropdown', String(value || '').trim().toLowerCase());
    applyAdminGalleryFilters({ resetPage: true });
}

function getPromptInteractionMetricForSite(prompt = {}, site = getAdminPromptsReadSite()) {
    const metrics = normalizePromptSiteMetrics(prompt);
    const normalizedSite = String(site || '').trim().toLowerCase();
    if (normalizedSite === 'cn' || normalizedSite === 'intl') {
        return metrics[normalizedSite];
    }
    return metrics.total;
}

function getPromptEngagementScore(prompt = {}, site = getAdminPromptsReadSite()) {
    const metric = getPromptInteractionMetricForSite(prompt, site);
    return (Number(metric.unlock_count || 0) * 3) + Number(metric.comment_count || 0);
}

function getPromptSortTimestamp(prompt = {}, fieldName = 'updated_at') {
    const value = new Date(prompt?.[fieldName] || 0).getTime();
    return Number.isFinite(value) ? value : 0;
}

function compareAdminGalleryPrompts(leftPrompt = {}, rightPrompt = {}, sortValue = getAdminGallerySortValue()) {
    const normalizedSortValue = normalizeAdminGallerySortValue(sortValue);
    const currentSite = getAdminPromptsReadSite();
    const safeLeftPrompt = leftPrompt && typeof leftPrompt === 'object' ? leftPrompt : {};
    const safeRightPrompt = rightPrompt && typeof rightPrompt === 'object' ? rightPrompt : {};
    const leftTitle = String(safeLeftPrompt.title || safeLeftPrompt.title_zh || safeLeftPrompt.title_en || '').trim();
    const rightTitle = String(safeRightPrompt.title || safeRightPrompt.title_zh || safeRightPrompt.title_en || '').trim();

    if (normalizedSortValue === 'title-asc') {
        return leftTitle.localeCompare(rightTitle, 'zh-CN', { sensitivity: 'base' });
    }

    if (normalizedSortValue === 'created-desc') {
        const createdDelta = getPromptSortTimestamp(safeRightPrompt, 'created_at') - getPromptSortTimestamp(safeLeftPrompt, 'created_at');
        return createdDelta || leftTitle.localeCompare(rightTitle, 'zh-CN', { sensitivity: 'base' });
    }

    if (normalizedSortValue === 'engagement-desc') {
        const scoreDelta = getPromptEngagementScore(safeRightPrompt, currentSite) - getPromptEngagementScore(safeLeftPrompt, currentSite);
        if (scoreDelta) return scoreDelta;
    }

    if (normalizedSortValue === 'status-priority') {
        const leftPriority = ADMIN_GALLERY_STATUS_PRIORITY[getPromptLifecycleState(safeLeftPrompt).key] ?? 99;
        const rightPriority = ADMIN_GALLERY_STATUS_PRIORITY[getPromptLifecycleState(safeRightPrompt).key] ?? 99;
        const priorityDelta = leftPriority - rightPriority;
        if (priorityDelta) return priorityDelta;
    }

    const updatedDelta = getPromptSortTimestamp(safeRightPrompt, 'updated_at') - getPromptSortTimestamp(safeLeftPrompt, 'updated_at');
    if (updatedDelta) return updatedDelta;

    const createdDelta = getPromptSortTimestamp(safeRightPrompt, 'created_at') - getPromptSortTimestamp(safeLeftPrompt, 'created_at');
    if (createdDelta) return createdDelta;

    return leftTitle.localeCompare(rightTitle, 'zh-CN', { sensitivity: 'base' });
}

function getAdminGallerySortValue() {
    const inputValue = document.getElementById('sortFilter')?.value || adminGalleryViewState.sortValue;
    return normalizeAdminGallerySortValue(inputValue);
}

function sortAdminGalleryCards(sortValue = getAdminGallerySortValue()) {
    const grid = document.getElementById('adminGrid');
    if (!grid) {
        return;
    }

    const emptyMessage = grid.querySelector('.no-results-message');
    const cards = getAdminGalleryCards().sort((leftCard, rightCard) => {
        const leftPrompt = getAdminGalleryPromptById(leftCard.dataset.id || '');
        const rightPrompt = getAdminGalleryPromptById(rightCard.dataset.id || '');
        return compareAdminGalleryPrompts(leftPrompt, rightPrompt, sortValue);
    });

    cards.forEach((card) => grid.appendChild(card));
    if (emptyMessage) {
        grid.appendChild(emptyMessage);
    }
}

function summarizeAdminGalleryOps(rows = allPrompts) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const counts = {
        all: safeRows.length,
        draft: 0,
        review: 0,
        'homepage-candidate': 0,
        featured: 0,
        'needs-localization': 0,
        live: 0,
        archived: 0
    };
    const siteTotals = {
        cn: { unlock_count: 0, comment_count: 0 },
        intl: { unlock_count: 0, comment_count: 0 }
    };

    safeRows.forEach((prompt) => {
        const lifecycleKey = getPromptLifecycleState(prompt).key;
        if (Object.prototype.hasOwnProperty.call(counts, lifecycleKey)) {
            counts[lifecycleKey] += 1;
        }

        const metrics = normalizePromptSiteMetrics(prompt);
        siteTotals.cn.unlock_count += Number(metrics.cn.unlock_count || 0);
        siteTotals.cn.comment_count += Number(metrics.cn.comment_count || 0);
        siteTotals.intl.unlock_count += Number(metrics.intl.unlock_count || 0);
        siteTotals.intl.comment_count += Number(metrics.intl.comment_count || 0);
    });

    return { counts, siteTotals };
}

function renderGalleryOpsOverview() {
    const container = document.getElementById('galleryOpsOverview');
    if (!container) {
        return;
    }

    if (!Array.isArray(allPrompts) || allPrompts.length === 0) {
        container.innerHTML = '';
        return;
    }

    const { counts, siteTotals } = summarizeAdminGalleryOps(allPrompts);
    const activeStatus = String(document.getElementById('statusFilter')?.value || '').trim().toLowerCase();
    const currentSite = getAdminPromptsReadSite();
    const sortValue = getAdminGallerySortValue();
    const statusCards = [
        { key: '', label: '全部提示词', count: counts.all },
        { key: 'draft', label: '草稿', count: counts.draft },
        { key: 'review', label: '待复核', count: counts.review },
        { key: 'homepage-candidate', label: '首页候选', count: counts['homepage-candidate'] },
        { key: 'featured', label: '已上首页', count: counts.featured },
        { key: 'needs-localization', label: '待补双语', count: counts['needs-localization'] },
        { key: 'live', label: '有互动', count: counts.live },
        { key: 'archived', label: '已归档', count: counts.archived }
    ];

    container.innerHTML = `
        <div class="gallery-ops-overview__status-row">
            ${statusCards.map((item) => `
                <button
                    type="button"
                    class="gallery-ops-overview__status-btn${(activeStatus || '') === item.key ? ' is-active' : ''}"
                    data-admin-action="gallery-set-status-filter"
                    data-gallery-status-filter="${escapeHtml(item.key)}">
                    <span class="gallery-ops-overview__status-label">${escapeHtml(item.label)}</span>
                    <strong class="gallery-ops-overview__status-count">${escapeHtml(String(item.count))}</strong>
                </button>
            `).join('')}
        </div>
        <div class="gallery-ops-overview__meta">
            <span class="gallery-ops-overview__meta-pill">CN 解锁 ${escapeHtml(String(siteTotals.cn.unlock_count))} · 评论 ${escapeHtml(String(siteTotals.cn.comment_count))}</span>
            <span class="gallery-ops-overview__meta-pill">EN 解锁 ${escapeHtml(String(siteTotals.intl.unlock_count))} · 评论 ${escapeHtml(String(siteTotals.intl.comment_count))}</span>
            <span class="gallery-ops-overview__hint">当前视角 ${escapeHtml(currentSite === 'intl' ? 'EN' : (currentSite === 'cn' ? 'CN' : '全部站点'))} · 排序 ${escapeHtml(ADMIN_GALLERY_SORT_LABELS[sortValue] || ADMIN_GALLERY_SORT_LABELS['updated-desc'])}</span>
        </div>
    `;
}

function matchesAdminGalleryLanguageFilter(prompt, languageValue = '') {
    const normalizedValue = String(languageValue || '').trim().toLowerCase();
    if (!normalizedValue) {
        return true;
    }

    const coverage = getPromptLanguageCoverage(prompt);
    if (normalizedValue === 'bilingual-ready') {
        return coverage.zh && coverage.en;
    }
    if (normalizedValue === 'zh-ready') {
        return coverage.zh;
    }
    if (normalizedValue === 'en-ready') {
        return coverage.en;
    }
    if (normalizedValue === 'needs-translation') {
        return !(coverage.zh && coverage.en);
    }

    return true;
}

function matchesAdminGalleryStatusFilter(prompt, statusValue = '') {
    const normalizedValue = String(statusValue || '').trim().toLowerCase();
    if (!normalizedValue) {
        return true;
    }
    return getPromptLifecycleState(prompt).key === normalizedValue;
}

function focusAdminGalleryPromptCard(promptId = '', options = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return false;
    }

    const escapedPromptId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(normalizedPromptId)
        : normalizedPromptId.replace(/["\\]/g, '\\$&');
    const targetCard = document.querySelector(`#adminGrid .admin-card[data-id="${escapedPromptId}"]`);
    if (!targetCard) {
        return false;
    }

    if (options.resetFilters !== false) {
        resetAdminGalleryManageFilters();
        applyAdminGalleryFilters({ resetPage: true });
    }

    const visibleCards = getAdminGalleryCards().filter((card) => !card.classList.contains('admin-card--hidden-by-search'));
    const targetIndex = visibleCards.findIndex((card) => String(card.dataset.id || '') === normalizedPromptId);
    if (targetIndex >= 0) {
        adminGalleryViewState.page = Math.floor(targetIndex / adminGalleryViewState.pageSize) + 1;
        renderAdminGalleryPagination();
    }

    getAdminGalleryCards().forEach((card) => card.classList.remove('is-focused'));
    targetCard.classList.add('is-focused');

    if (options.scroll !== false) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    syncAdminGalleryRouteState({
        view: 'manage',
        promptId: normalizedPromptId
    }, {
        ensureGalleryModule: true
    });
    pendingAdminGalleryFocusPromptId = '';
    return true;
}

function openAdminGalleryPromptContext(promptId = '', options = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return false;
    }

    queueAdminGalleryPromptFocus(normalizedPromptId);
    syncAdminGalleryRouteState({
        view: 'manage',
        promptId: normalizedPromptId
    }, {
        ensureGalleryModule: true
    });

    if (options.ensureModule === true) {
        window.switchModule?.('gallery');
    }

    switchView('manage');
    return true;
}

function invalidateAdminGalleryPrefetch() {
    adminGalleryPrefetchState.site = '';
    adminGalleryPrefetchState.loaded = false;
    adminGalleryPrefetchState.promise = null;
    markAdminGalleryPromptListStale();
}

async function renderLoadedAdminPromptRows(rows = [], { siteContext = getAdminPromptsReadSite(), resetPage = true } = {}) {
    const grid = document.getElementById('adminGrid');
    const pagination = document.getElementById('adminGalleryPagination');
    if (!grid) {
        return false;
    }

    const safeRows = Array.isArray(rows) ? rows : [];
    const normalizedSite = normalizeAdminGallerySite(siteContext);
    renderGallerySiteContextBanner(siteContext || normalizedSite);
    adminGalleryPrefetchState.site = normalizedSite;
    adminGalleryPrefetchState.loaded = true;

    allPrompts = safeRows;
    SEARCH_INDEX = null;
    HOT_TAGS_CACHE = null;

    if (safeRows.length > 0) {
        const fragment = document.createDocumentFragment();
        safeRows.forEach((prompt) => {
            fragment.appendChild(renderAdminCard(prompt));
        });
        grid.replaceChildren(fragment);
        renderGalleryOpsOverview();
        setAdminGallerySortFilterValue(document.getElementById('sortFilter')?.value || adminGalleryViewState.sortValue);
        updateBatchButtonStates();

        const searchInput = document.getElementById('adminSearchInput');
        const activeQuery = String(searchInput?.value || '').trim().toLowerCase();
        adminGalleryViewState.searchQuery = activeQuery;
        setupAdminSearch();

        if (activeQuery) {
            await filterBySearch(activeQuery);
        } else {
            adminGalleryViewState.searchMatchedIds = null;
            applyAdminGalleryFilters({ resetPage });
        }

        const routePromptId = pendingAdminGalleryFocusPromptId || getAdminGalleryRouteState().promptId;
        if (routePromptId && isGalleryModuleActive() && isGalleryManageViewActive()) {
            window.requestAnimationFrame(() => {
                focusAdminGalleryPromptCard(routePromptId, {
                    resetFilters: true,
                    scroll: isGalleryManageViewActive()
                });
            });
        }
    } else {
        renderGalleryOpsOverview();
        renderAdminStudioEmptyMessage(grid, 'No prompts yet. Create your first one!');
        if (pagination) {
            pagination.innerHTML = '';
        }
    }

    markAdminGalleryPromptListLoaded(normalizedSite);
    return true;
}

function prefetchGalleryModule() {
    const galleryModule = document.getElementById('module-gallery');
    if (!galleryModule) {
        return Promise.resolve(false);
    }

    const site = normalizeAdminGallerySite(getAdminPromptsReadSite());
    if (adminGalleryPrefetchState.loaded && adminGalleryPrefetchState.site === site) {
        return Promise.resolve(true);
    }

    if (adminGalleryPrefetchState.promise && adminGalleryPrefetchState.site === site) {
        return adminGalleryPrefetchState.promise;
    }

    adminGalleryPrefetchState.site = site;
    adminGalleryPrefetchState.loaded = false;
    adminGalleryPrefetchState.promise = Promise.resolve()
        .then(() => loadAdminPrompts({ allowCached: true }))
        .then(() => {
            adminGalleryPrefetchState.loaded = true;
            return true;
        })
        .catch((error) => {
            adminGalleryPrefetchState.loaded = false;
            throw error;
        })
        .finally(() => {
            adminGalleryPrefetchState.promise = null;
        });

    return adminGalleryPrefetchState.promise;
}

function isGalleryModuleActive() {
    const module = document.getElementById('module-gallery');
    return Boolean(module && module.classList.contains('active') && window.getComputedStyle(module).display !== 'none');
}

function normalizeAdminGalleryPage(page, fallback = 1) {
    const parsed = Number.parseInt(page, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return Math.max(1, Number.parseInt(fallback, 10) || 1);
}

function getAdminGalleryCards() {
    return Array.from(document.querySelectorAll('#adminGrid .admin-card'));
}

function syncAdminGalleryPaginationCardVisibility(card, visible) {
    if (!card) return;
    card.classList.toggle('admin-card--hidden-by-pagination', !visible);
}

function getAdminGalleryPromptById(id) {
    return allPrompts.find((prompt) => String(prompt?.id || '') === String(id || '')) || null;
}

function upsertAdminGalleryPromptCacheRow(nextRow = {}) {
    const normalizedId = String(nextRow?.id || '').trim();
    if (!normalizedId) {
        return null;
    }

    const currentIndex = allPrompts.findIndex((prompt) => String(prompt?.id || '') === normalizedId);
    if (currentIndex >= 0) {
        allPrompts[currentIndex] = {
            ...allPrompts[currentIndex],
            ...nextRow
        };
        return allPrompts[currentIndex];
    }

    allPrompts.unshift({ ...nextRow, id: normalizedId });
    return allPrompts[0];
}

function replaceAdminGalleryPromptCard(promptId = '') {
    const normalizedId = String(promptId || '').trim();
    if (!normalizedId) {
        return false;
    }

    const prompt = getAdminGalleryPromptById(normalizedId);
    if (!prompt) {
        return false;
    }

    const existingCard = document.querySelector(`#adminGrid .admin-card[data-id="${CSS.escape(normalizedId)}"]`);
    if (!existingCard) {
        return false;
    }

    const nextCard = renderAdminCard(prompt);
    existingCard.replaceWith(nextCard);
    return true;
}

function hydrateAdminGalleryPromptsLocally(rows = []) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
        return;
    }

    safeRows.forEach((row) => {
        const mergedRow = upsertAdminGalleryPromptCacheRow(row);
        if (mergedRow) {
            replaceAdminGalleryPromptCard(mergedRow.id);
        }
    });

    renderGalleryOpsOverview();
    applyAdminGalleryFilters();
    updateBatchButtonStates();
}

async function resolveAdminGalleryPromptForHomepageAction(promptId = '', options = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return null;
    }

    const cachedPrompt = getAdminGalleryPromptById(normalizedPromptId);
    if (cachedPrompt) {
        return cachedPrompt;
    }

    try {
        const payload = await fetchAdminPromptItem(normalizedPromptId, {
            site: options.site || getAdminPromptsReadSite()
        });
        return payload?.row || null;
    } catch (error) {
        console.warn('[Gallery] Failed to resolve prompt for homepage action:', error);
        return null;
    }
}

async function addPromptToHomepagePromptsSection(promptId = '', options = {}) {
    const prompt = await resolveAdminGalleryPromptForHomepageAction(promptId, options);
    if (!prompt) {
        showToast('未找到要加入首页的 Prompt', 'error');
        return false;
    }

    try {
        await window.HomepageAdmin?.addFeaturedPrompt?.(prompt, {
            navigate: options.navigate === true,
            site: options.site
        });
        if (isGalleryModuleActive() && isGalleryManageViewActive()) {
            queueAdminGalleryPromptFocus(prompt.id || promptId);
            await loadAdminPrompts();
        }
        return true;
    } catch (error) {
        console.error('[Gallery] Failed to add prompt to homepage:', error);
        showToast(`加入首页失败: ${error.message || '未知错误'}`, 'error');
        return false;
    }
}

function matchesAdminGalleryDateFilter(prompt, dateValue = '') {
    if (!prompt || !dateValue) {
        return true;
    }

    const createdAt = new Date(prompt.created_at || prompt.createdAt || 0);
    if (Number.isNaN(createdAt.getTime())) {
        return false;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(todayStart);
    monthStart.setMonth(monthStart.getMonth() - 1);

    switch (String(dateValue || '').trim()) {
        case 'today':
            return createdAt >= todayStart;
        case 'week':
            return createdAt >= weekStart;
        case 'month':
            return createdAt >= monthStart;
        default:
            return true;
    }
}

function renderAdminGalleryPagination() {
    const container = document.getElementById('adminGalleryPagination');
    const grid = document.getElementById('adminGrid');
    if (!container || !grid) {
        return;
    }

    const filteredCards = getAdminGalleryCards().filter((card) => !card.classList.contains('admin-card--hidden-by-search'));
    const totalItems = filteredCards.length;

    if (totalItems <= 0) {
        container.innerHTML = '';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(totalItems / adminGalleryViewState.pageSize));
    const currentPage = Math.min(
        Math.max(1, normalizeAdminGalleryPage(adminGalleryViewState.page, 1)),
        totalPages
    );
    adminGalleryViewState.page = currentPage;

    const pageStartIndex = (currentPage - 1) * adminGalleryViewState.pageSize;
    const pageEndIndex = pageStartIndex + adminGalleryViewState.pageSize;

    getAdminGalleryCards().forEach((card) => {
        syncAdminGalleryPaginationCardVisibility(card, false);
    });

    filteredCards.forEach((card, index) => {
        const isVisibleOnPage = index >= pageStartIndex && index < pageEndIndex;
        syncAdminGalleryPaginationCardVisibility(card, isVisibleOnPage);
    });

    container.innerHTML = `
        <div class="pagination-shell comments-pagination-shell__inner">
            <div class="pagination-control">
                <button class="pagination-btn pagination-btn--step"
                    type="button"
                    data-admin-action="gallery-pagination-go"
                    data-gallery-page="${currentPage - 1}"
                    ${currentPage <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i>
                </button>
                <input type="number"
                    class="pagination-input"
                    value="${currentPage}"
                    min="1"
                    max="${totalPages}"
                    data-admin-change-action="gallery-pagination-go"
                    data-gallery-page-max="${totalPages}">
                <button class="pagination-btn pagination-btn--step"
                    type="button"
                    data-admin-action="gallery-pagination-go"
                    data-gallery-page="${currentPage + 1}"
                    ${currentPage >= totalPages ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
            <div class="pagination-total pagination-total--compact">第 ${currentPage} / ${totalPages} 页 · 共 ${totalItems} 条</div>
        </div>
    `;
}

function applyAdminGalleryFilters(options = {}) {
    const grid = document.getElementById('adminGrid');
    const pagination = document.getElementById('adminGalleryPagination');
    if (!grid) {
        return;
    }

    if (options.resetPage) {
        adminGalleryViewState.page = 1;
    }

    if (!Array.isArray(allPrompts) || allPrompts.length === 0) {
        renderAdminStudioEmptyMessage(grid, 'No prompts yet. Create your first one!');
        if (pagination) {
            pagination.innerHTML = '';
        }
        return;
    }

    const searchQuery = String(adminGalleryViewState.searchQuery || '').trim().toLowerCase();
    const searchMatchedIds = adminGalleryViewState.searchMatchedIds instanceof Set
        ? adminGalleryViewState.searchMatchedIds
        : null;
    const categoryValue = document.getElementById('categoryFilter')?.value || '';
    const dateValue = document.getElementById('dateFilter')?.value || '';
    const languageValue = document.getElementById('languageFilter')?.value || '';
    const statusValue = document.getElementById('statusFilter')?.value || '';
    const sortValue = normalizeAdminGallerySortValue(document.getElementById('sortFilter')?.value || adminGalleryViewState.sortValue);
    adminGalleryViewState.sortValue = sortValue;

    sortAdminGalleryCards(sortValue);
    renderGalleryOpsOverview();

    let visibleCount = 0;

    getAdminGalleryCards().forEach((card) => {
        const cardId = String(card.dataset.id || '');
        const prompt = getAdminGalleryPromptById(cardId);
        if (!prompt) {
            syncAdminSearchCardVisibility(card, false);
            syncAdminGalleryPaginationCardVisibility(card, false);
            return;
        }

        let visible = true;

        if (categoryValue) {
            const tags = Array.isArray(prompt.tags) ? prompt.tags : [];
            visible = tags.some((tag) => String(tag || '').toLowerCase() === String(categoryValue).toLowerCase());
        }

        if (visible && !matchesAdminGalleryDateFilter(prompt, dateValue)) {
            visible = false;
        }

        if (visible && !matchesAdminGalleryLanguageFilter(prompt, languageValue)) {
            visible = false;
        }

        if (visible && !matchesAdminGalleryStatusFilter(prompt, statusValue)) {
            visible = false;
        }

        if (visible && searchQuery && searchMatchedIds) {
            visible = searchMatchedIds.has(cardId);
        }

        syncAdminSearchCardVisibility(card, visible);
        if (!visible) {
            syncAdminGalleryPaginationCardVisibility(card, false);
            return;
        }

        visibleCount += 1;
    });

    const existingMsg = grid.querySelector('.no-results-message');
    if (visibleCount === 0) {
        getAdminGalleryCards().forEach((card) => {
            syncAdminGalleryPaginationCardVisibility(card, false);
        });

        if (!existingMsg) {
            const emptyText = searchQuery || categoryValue || dateValue || languageValue || statusValue
                ? '没有找到匹配的提示词'
                : 'No prompts yet. Create your first one!';
            grid.appendChild(createAdminStudioEmptyElement(emptyText, 'no-results-message'));
        } else if (!searchQuery && !categoryValue && !dateValue && !languageValue && !statusValue) {
            existingMsg.textContent = 'No prompts yet. Create your first one!';
        }

        if (pagination) {
            pagination.innerHTML = '';
        }
        return;
    }

    if (existingMsg) {
        existingMsg.remove();
    }

    renderAdminGalleryPagination();
}

function changeAdminGalleryPage(page) {
    adminGalleryViewState.page = normalizeAdminGalleryPage(page, adminGalleryViewState.page);
    renderAdminGalleryPagination();
}

function prefetchSettingsModule() {
    renderApiKeySelector();
    return Promise.resolve(true);
}

let opsAlertsPrefetchPromise = null;

function prefetchOpsAlertsModule() {
    if (opsAlertsPrefetchPromise) {
        return opsAlertsPrefetchPromise;
    }

    const tasks = [
        window.loadOpsAlertSettings,
        window.loadOpsAlertHealth,
        window.loadOpsAlertMonitor
    ].filter((loader) => typeof loader === 'function');

    if (!tasks.length) {
        return Promise.resolve(false);
    }

    opsAlertsPrefetchPromise = Promise.allSettled(tasks.map((loader) => loader()))
        .finally(() => {
            opsAlertsPrefetchPromise = null;
        });

    return opsAlertsPrefetchPromise;
}

window.prefetchGalleryModule = prefetchGalleryModule;
window.loadAdminPrompts = loadAdminPrompts;
window.openAdminGalleryPromptContext = openAdminGalleryPromptContext;
window.setAdminGalleryStatusFilter = setAdminGalleryStatusFilter;
window.batchSetSelectedPromptStatus = batchSetSelectedPromptStatus;
window.batchAddSelectedPromptsToHomepage = batchAddSelectedPromptsToHomepage;
window.batchCompleteSelectedPromptBilingualFields = batchCompleteSelectedPromptBilingualFields;
window.addPromptToHomepagePromptsSection = addPromptToHomepagePromptsSection;
window.prefetchSettingsModule = prefetchSettingsModule;
window.prefetchOpsAlertsModule = prefetchOpsAlertsModule;

function handleAdminGallerySiteChange() {
    invalidateAdminGalleryPrefetch();
    renderGallerySiteContextBanner();

    if (!isGalleryModuleActive()) {
        return;
    }

    if (isGalleryManageViewActive()) {
        void loadAdminPrompts({ force: true });
    }
}

window.handleAdminGallerySiteChange = handleAdminGallerySiteChange;

function handleAdminGalleryShellContext(context = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const rawContext = normalizedContext.raw && typeof normalizedContext.raw === 'object' ? normalizedContext.raw : {};
    const payload = normalizedContext.payload && typeof normalizedContext.payload === 'object' ? normalizedContext.payload : {};
    const focus = normalizedContext.focus && typeof normalizedContext.focus === 'object' ? normalizedContext.focus : {};
    const promptId = String(
        focus.promptId
        || rawContext.promptId
        || rawContext.prompt_id
        || payload.promptId
        || payload.prompt_id
        || rawContext.id
        || ''
    ).trim();

    if (promptId) {
        return openAdminGalleryPromptContext(promptId, { ensureModule: false });
    }

    return false;
}

if (window.AdminShell?.registerModule) {
    window.AdminShell.registerModule('gallery', {
        onSiteChange: handleAdminGallerySiteChange,
        handleContext: handleAdminGalleryShellContext,
        reload: handleAdminGallerySiteChange
    });
} else {
    window.addEventListener('admin-site-changed', () => {
        handleAdminGallerySiteChange();
    });
}

function promptHasVisibleCopy(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function getPromptLanguageCoverage(prompt = {}) {
    return {
        zh: promptHasVisibleCopy(prompt.title_zh)
            || promptHasVisibleCopy(prompt.description_zh)
            || promptHasVisibleCopy(prompt.prompt_text_zh),
        en: promptHasVisibleCopy(prompt.title_en)
            || promptHasVisibleCopy(prompt.description_en)
            || promptHasVisibleCopy(prompt.prompt_text_en)
    };
}

function normalizePromptSiteMetrics(prompt = {}) {
    const rawMetrics = prompt && typeof prompt.site_metrics === 'object' && prompt.site_metrics
        ? prompt.site_metrics
        : {};
    const normalizeMetricValue = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };
    const normalizeSiteMetric = (value = {}) => ({
        unlock_count: normalizeMetricValue(value.unlock_count),
        comment_count: normalizeMetricValue(value.comment_count)
    });

    return {
        cn: normalizeSiteMetric(rawMetrics.cn),
        intl: normalizeSiteMetric(rawMetrics.intl),
        total: normalizeSiteMetric(rawMetrics.total)
    };
}

function buildPromptSiteMetricElement(siteLabel, siteMetrics, currentSite = 'all') {
    const metricRow = document.createElement('div');
    const siteKey = String(siteLabel || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
    metricRow.className = 'admin-card-site-metric';
    if (currentSite === siteKey) {
        metricRow.classList.add('is-current');
    }

    const metricLabel = document.createElement('span');
    metricLabel.className = 'admin-card-site-metric__label';
    metricLabel.textContent = siteLabel;
    metricRow.appendChild(metricLabel);

    const metricCounts = document.createElement('span');
    metricCounts.className = 'admin-card-site-metric__counts';
    metricCounts.textContent = `解锁 ${siteMetrics.unlock_count} · 评论 ${siteMetrics.comment_count}`;
    metricRow.appendChild(metricCounts);

    return metricRow;
}

async function loadAdminPrompts(options = {}) {
    const site = normalizeAdminGallerySite(options?.site || getAdminPromptsReadSite());
    const force = options?.force === true;
    const allowCached = options?.allowCached === true;
    const resetPage = options?.resetPage !== false;

    if (!force && allowCached && hasFreshAdminGalleryPromptList(site)) {
        await renderLoadedAdminPromptRows(allPrompts, {
            siteContext: site,
            resetPage
        });
        return {
            rows: allPrompts,
            siteContext: site,
            fromCache: true
        };
    }

    if (!force && allowCached && adminGalleryLoadState.promise && adminGalleryLoadState.site === site) {
        return adminGalleryLoadState.promise;
    }

    const requestId = adminGalleryLoadState.requestId + 1;
    adminGalleryLoadState.requestId = requestId;
    adminGalleryLoadState.site = site;
    adminGalleryLoadState.loaded = false;

    const loadPromise = (async () => {
        try {
            if (typeof window.HomepageAdmin?.ensureLoaded === 'function') {
                try {
                    await window.HomepageAdmin.ensureLoaded();
                } catch (homepageError) {
                    console.warn('[Gallery] Failed to warm homepage featured state:', homepageError);
                }
            }
            const payload = await fetchAdminPromptList({ site });
            if (requestId !== adminGalleryLoadState.requestId) {
                return {
                    rows: allPrompts,
                    siteContext: site,
                    stale: true
                };
            }

            await renderLoadedAdminPromptRows(payload.rows || [], {
                siteContext: payload.siteContext || site,
                resetPage
            });
            return {
                ...payload,
                fromCache: false
            };
        } catch (err) {
            if (requestId === adminGalleryLoadState.requestId) {
                adminGalleryPrefetchState.loaded = false;
                markAdminGalleryPromptListStale(site);
            }
            console.error('Error loading prompts:', err);
            showToast(`Failed to load prompts: ${err.message || 'Unknown error'}`, 'error');
            throw err;
        }
    })();

    adminGalleryLoadState.promise = loadPromise;

    try {
        return await loadPromise;
    } finally {
        if (adminGalleryLoadState.promise === loadPromise) {
            adminGalleryLoadState.promise = null;
        }
    }
}

// ========================================
// RENDER ADMIN CARD
// ========================================
function renderAdminCard(prompt) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.dataset.id = String(prompt.id ?? '');
    if (isSelectMode && selectedPrompts.has(String(prompt.id ?? ''))) {
        card.classList.add('selected');
    }
    const languageCoverage = getPromptLanguageCoverage(prompt);
    const siteMetrics = normalizePromptSiteMetrics(prompt);
    const currentSite = getAdminPromptsReadSite();
    const lifecycleState = getPromptLifecycleState(prompt);
    const featureState = getPromptHomepageFeatureState(prompt.id, currentSite);
    const opsSummary = buildPromptAdminOpsSummary(prompt);
    const updatedAtLabel = prompt.updated_at
        ? new Date(prompt.updated_at).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        : (prompt.created_at
            ? new Date(prompt.created_at).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
            : '未记录');

    const checkbox = document.createElement('span');
    checkbox.className = 'select-checkbox';
    checkbox.innerHTML = '<i class="fas fa-check"></i>';
    card.appendChild(checkbox);

    const media = document.createElement('div');
    media.className = 'admin-card-media';

    const image = document.createElement('img');
    image.className = 'admin-card-image';
    image.alt = prompt.title || 'Prompt cover';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';

    const imageUrl = sanitizePromptImageUrl(Array.isArray(prompt.images) ? prompt.images[0] : '');
    if (imageUrl) {
        image.src = imageUrl;
    } else {
        image.removeAttribute('src');
    }
    media.appendChild(image);

    const badges = document.createElement('div');
    badges.className = 'admin-card-badges admin-card-badges--overlay';

    const globalBadge = document.createElement('span');
    globalBadge.className = 'admin-card-badge admin-card-badge--global';
    globalBadge.textContent = 'Global Asset';
    badges.appendChild(globalBadge);

    const zhBadge = document.createElement('span');
    zhBadge.className = `admin-card-badge admin-card-badge--lang ${languageCoverage.zh ? 'is-ready' : 'is-missing'}`;
    zhBadge.textContent = 'ZH';
    badges.appendChild(zhBadge);

    const enBadge = document.createElement('span');
    enBadge.className = `admin-card-badge admin-card-badge--lang ${languageCoverage.en ? 'is-ready' : 'is-missing'}`;
    enBadge.textContent = 'EN';
    badges.appendChild(enBadge);

    if (Array.isArray(prompt.tags) && prompt.tags[0]) {
        const categoryBadge = document.createElement('span');
        categoryBadge.className = 'admin-card-badge admin-card-badge--category';
        categoryBadge.textContent = prompt.tags[0];
        badges.appendChild(categoryBadge);
    }

    media.appendChild(badges);
    card.appendChild(media);

    const content = document.createElement('div');
    content.className = 'admin-card-content';

    const header = document.createElement('div');
    header.className = 'admin-card-header';

    const title = document.createElement('div');
    title.className = 'admin-card-title';
    title.textContent = prompt.title || 'Untitled Prompt';
    header.appendChild(title);

    const statusBadge = document.createElement('span');
    statusBadge.className = `admin-card-status admin-card-status--${lifecycleState.key}`;
    statusBadge.textContent = lifecycleState.label;
    header.appendChild(statusBadge);
    content.appendChild(header);

    const subtitle = document.createElement('div');
    subtitle.className = 'admin-card-subtitle';
    subtitle.textContent = prompt.description || prompt.description_en || prompt.description_zh || 'Global prompt asset with explicit bilingual copy coverage.';
    content.appendChild(subtitle);

    const metaRow = document.createElement('div');
    metaRow.className = 'admin-card-meta-row';

    const languageSummary = document.createElement('div');
    languageSummary.className = 'admin-card-language-summary';
    languageSummary.textContent = `语言覆盖: ZH ${languageCoverage.zh ? 'ready' : 'missing'} · EN ${languageCoverage.en ? 'ready' : 'missing'}`;
    metaRow.appendChild(languageSummary);

    const updatedAt = document.createElement('div');
    updatedAt.className = 'admin-card-updated-at';
    updatedAt.textContent = `更新于 ${updatedAtLabel}`;
    metaRow.appendChild(updatedAt);
    content.appendChild(metaRow);

    const metrics = document.createElement('div');
    metrics.className = 'admin-card-site-metrics';
    metrics.appendChild(buildPromptSiteMetricElement('CN', siteMetrics.cn, currentSite));
    metrics.appendChild(buildPromptSiteMetricElement('INTL', siteMetrics.intl, currentSite));
    content.appendChild(metrics);

    if (opsSummary) {
        const opsNote = document.createElement('div');
        opsNote.className = 'admin-card-ops-note';
        opsNote.textContent = opsSummary;
        content.appendChild(opsNote);
    }

    const contextActions = document.createElement('div');
    contextActions.className = 'admin-card-context-actions';

    const commentsBtn = document.createElement('button');
    commentsBtn.className = 'admin-card-context-btn';
    commentsBtn.type = 'button';
    commentsBtn.setAttribute('data-admin-action', 'gallery-open-prompt-comments');
    commentsBtn.setAttribute('data-prompt-id', encodeURIComponent(String(prompt.id || '')));
    commentsBtn.setAttribute('data-prompt-title', encodeURIComponent(String(prompt.title || prompt.title_zh || prompt.title_en || '')));
    commentsBtn.innerHTML = '<i class="fas fa-comments"></i> 评论';
    contextActions.appendChild(commentsBtn);

    const analyticsBtn = document.createElement('button');
    analyticsBtn.className = 'admin-card-context-btn';
    analyticsBtn.type = 'button';
    analyticsBtn.setAttribute('data-admin-action', 'gallery-open-prompt-analytics');
    analyticsBtn.setAttribute('data-prompt-id', encodeURIComponent(String(prompt.id || '')));
    analyticsBtn.innerHTML = '<i class="fas fa-chart-line"></i> 分析';
    contextActions.appendChild(analyticsBtn);

    const homepageBtn = document.createElement('button');
    homepageBtn.className = 'admin-card-context-btn admin-card-context-btn--primary';
    if (featureState.currentSite) {
        homepageBtn.classList.add('is-active');
    }
    homepageBtn.type = 'button';
    homepageBtn.setAttribute('data-admin-action', featureState.currentSite ? 'gallery-open-prompt-homepage' : 'gallery-add-prompt-homepage');
    homepageBtn.setAttribute('data-prompt-id', encodeURIComponent(String(prompt.id || '')));
    homepageBtn.innerHTML = featureState.currentSite
        ? '<i class="fas fa-house"></i> 去首页'
        : '<i class="fas fa-thumbtack"></i> 加首页';
    contextActions.appendChild(homepageBtn);
    content.appendChild(contextActions);

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
        const payload = await fetchAdminPromptItem(id);
        const data = payload.row;
        const promptOpsData = getPromptAdminOpsData(data);
        currentEditingPromptAiTags = clonePromptAiTags(data.ai_tags || {});

        // Switch to create view
        switchView('create');

        // Set mode to edit
        currentMode = 'edit';
        editingId = id;
        currentEditingPromptImageUrls = Array.isArray(data.images)
            ? data.images.map((url) => String(url || '').trim()).filter(Boolean)
            : [];

        // Show the form (it's hidden by default)
        const promptForm = document.getElementById('promptForm');
        setAdminStudioVisibility(promptForm, true);

        // Populate form fields
        populateForm({
            title: data.title || '',
            category: data.tags?.[0] || '',
            prompt_text: data.prompt_text || '',
            description: data.description || '',
            title_zh: data.title_zh || '',
            title_en: data.title_en || '',
            description_zh: data.description_zh || '',
            description_en: data.description_en || '',
            prompt_text_zh: data.prompt_text_zh || '',
            prompt_text_en: data.prompt_text_en || '',
            opsStatus: promptOpsData.status,
            opsNote: promptOpsData.note,
            objects: data.ai_tags?.objects,
            scenes: data.ai_tags?.scenes,
            styles: data.ai_tags?.styles,
            mood: data.ai_tags?.mood,
            dominantColors: data.dominant_colors || []
        });

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
            setAdminStudioVisibility(lastEditedInfo, true);
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
            setAdminStudioVisibility(lastEditedInfo, true);
        } else {
            setAdminStudioVisibility(lastEditedInfo, false);
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
        if (currentEditingPromptImageUrls.length > 0) {
            const previewGrid = document.getElementById('previewGrid');
            previewGrid.innerHTML = currentEditingPromptImageUrls.map((url, idx) => `
                <div class="preview-item">
                    <img src="${url}" alt="Preview ${idx + 1}">
                </div>
            `).join('');

            // Clear and load images into uploadedFiles for analysis capability
            uploadedFiles = [];

            // Fetch and convert images to base64 for AI analysis
            for (const imageUrl of currentEditingPromptImageUrls) {
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

window.editPrompt = editPrompt;

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
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: '删除 Prompt' });
    if (!writableSite) {
        return;
    }

    if (!confirm('Delete this prompt? This action cannot be undone.')) {
        return;
    }

    console.log('Attempting to delete prompt with ID:', id);

    try {
        await deleteAdminPrompts({
            site: writableSite,
            id
        });

        console.log('Successfully deleted from database');

        // Remove from UI with animation
        const card = document.querySelector(`[data-id="${id}"]`);
        if (card) {
            card.classList.add('is-removing');
            setTimeout(() => {
                card.remove();
                allPrompts = allPrompts.filter((prompt) => String(prompt?.id || '') !== String(id));
                SEARCH_INDEX = null;
                HOT_TAGS_CACHE = null;
                selectedPrompts.delete(String(id));
                if (getAdminGalleryRouteState().promptId === String(id)) {
                    syncAdminGalleryRouteState({
                        view: isGalleryManageViewActive() ? 'manage' : 'create',
                        promptId: ''
                    });
                }
                if (pendingAdminGalleryFocusPromptId === String(id)) {
                    pendingAdminGalleryFocusPromptId = '';
                }
                applyAdminGalleryFilters();
                updateBatchButtonStates();
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
    const currentService = window.AdminAI?.getPreferredService?.() || window.ADMIN_AI_SERVICE || 'gemini';
    const normalizedCurrentService = window.AdminAI?.normalizeService?.(currentService) || String(currentService || 'gemini').trim().toLowerCase();
    const currentServiceLabel = window.AdminAI?.getServiceLabel?.(normalizedCurrentService) || 'AI Proxy';

    try {
        if (!window.AdminAI) {
            throw new Error('AdminAI client not loaded');
        }

        const payload = await window.AdminAI.checkHealth(true);

        if (normalizedCurrentService === 'gemini') {
            window.GEMINI_API_KEY = payload.configured ? '__server_proxy__' : '';
            window.GEMINI_API_SOURCE = payload.source || (payload.configured ? 'environment' : 'missing');
        }

        if (payload.configured) {
            updateStatus(`${currentServiceLabel} Ready`, 'ready');
        } else {
            updateStatus(`${currentServiceLabel} Missing`, 'error');
        }
    } catch (err) {
        console.warn('Failed to verify AI proxy:', err);

        if (normalizedCurrentService === 'gemini') {
            window.GEMINI_API_KEY = '';
            window.GEMINI_API_SOURCE = 'missing';
        }

        updateStatus(`${currentServiceLabel} Missing`, 'error');
    } finally {
        renderApiKeySelector();
        updateAnalyzeButton();
    }
}

function getApiKeys() {
    const keys = [];

    if (window.GEMINI_API_KEY) {
        keys.push({
            name: 'Gemini Server Proxy',
            key: '__server_proxy__',
            source: window.GEMINI_API_SOURCE || 'missing'
        });
    }

    const codexConfig = getCodexRuntimeConfig();
    if (codexConfig.configured) {
        keys.push({
            name: 'Codex Relay',
            key: '__server_proxy__',
            source: codexConfig.source || 'missing'
        });
    }

    return keys;
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

const DEFAULT_CODEX_CONFIG = Object.freeze({
    configured: false,
    source: 'missing',
    baseUrl: '',
    model: 'gpt-5.4',
    apiFormat: 'responses'
});

function normalizeCodexBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeCodexApiFormat(value) {
    return String(value || '').trim().toLowerCase() === 'chat.completions'
        ? 'chat.completions'
        : 'responses';
}

function getCodexRuntimeConfig() {
    const current = window.CODEX_RUNTIME_CONFIG;
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return { ...DEFAULT_CODEX_CONFIG };
    }

    return {
        ...DEFAULT_CODEX_CONFIG,
        ...current,
        baseUrl: normalizeCodexBaseUrl(current.baseUrl),
        model: String(current.model || DEFAULT_CODEX_CONFIG.model).trim() || DEFAULT_CODEX_CONFIG.model,
        apiFormat: normalizeCodexApiFormat(current.apiFormat)
    };
}

function setCodexRuntimeConfig(payload = {}) {
    const current = getCodexRuntimeConfig();
    const next = {
        ...current
    };

    if (Object.prototype.hasOwnProperty.call(payload, 'configured')) {
        next.configured = Boolean(payload.configured);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'source')) {
        next.source = String(payload.source || 'missing').trim() || 'missing';
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'baseUrl')) {
        next.baseUrl = normalizeCodexBaseUrl(payload.baseUrl);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'model')) {
        next.model = String(payload.model || DEFAULT_CODEX_CONFIG.model).trim() || DEFAULT_CODEX_CONFIG.model;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'apiFormat')) {
        next.apiFormat = normalizeCodexApiFormat(payload.apiFormat);
    }

    window.CODEX_RUNTIME_CONFIG = next;
    window.CODEX_CONFIG_SOURCE = next.source;
    return next;
}

function buildCodexRelaySummary(config = getCodexRuntimeConfig()) {
    const parts = [];
    if (config.baseUrl) parts.push(config.baseUrl);
    if (config.model) parts.push(config.model);
    if (config.apiFormat) parts.push(config.apiFormat);
    return parts.join(' · ');
}

function getCodexSourceMeta() {
    const config = getCodexRuntimeConfig();
    const source = config.source || 'missing';
    const relaySummary = buildCodexRelaySummary(config);

    if (source === 'stored') {
        return {
            source,
            title: '后台安全存储',
            preview: relaySummary
                ? `已托管 Codex Relay 配置 · ${relaySummary}`
                : '已托管 Codex Relay 配置，可随时切换中转站地址、模型和协议',
            badge: '后台托管',
            statusText: relaySummary
                ? `Codex Relay 已托管 · ${relaySummary}`
                : 'Codex Relay 已由后台安全存储'
        };
    }

    if (source === 'environment') {
        return {
            source,
            title: '环境变量',
            preview: relaySummary
                ? `当前由环境变量托管 · ${relaySummary}`
                : '当前由环境变量托管，保存后会切换为后台安全存储',
            badge: '环境变量',
            statusText: relaySummary
                ? `Codex Relay 当前由环境变量托管 · ${relaySummary}`
                : 'Codex Relay 当前由环境变量托管'
        };
    }

    return {
        source: 'missing',
        title: '未配置',
        preview: '请填写 Base URL / Model / 接口格式，并录入中转站 API Key',
        badge: '待配置',
        statusText: '未配置 Codex Relay'
    };
}

async function getAdminApiHeaders() {
    if (!window.AdminAI?.getAuthHeaders) {
        throw new Error('AdminAI client not loaded');
    }

    return window.AdminAI.getAuthHeaders();
}

async function refreshCodexConfig() {
    try {
        const headers = await getAdminApiHeaders();
        const response = await fetch('/api/admin?route=settings/codex-config', {
            method: 'GET',
            headers
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '读取 Codex 配置失败');
        }

        setCodexRuntimeConfig(payload);

        const currentService = window.AdminAI?.getPreferredService?.() || window.ADMIN_AI_SERVICE || 'gemini';
        const normalizedCurrentService = window.AdminAI?.normalizeService?.(currentService) || String(currentService || 'gemini').trim().toLowerCase();
        if (
            payload.configured
            && normalizedCurrentService === 'gemini'
            && !window.GEMINI_API_KEY
            && (window.GEMINI_API_SOURCE || 'missing') === 'missing'
        ) {
            await activateCodexAsCurrentAIService({ showToast: false });
        }
    } catch (err) {
        console.warn('Failed to load Codex config:', err);
        setCodexRuntimeConfig({
            configured: false,
            source: getCodexRuntimeConfig().source || 'missing'
        });
    } finally {
        renderApiKeySelector();
        renderCodexConfigPanel();
    }
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

async function saveServerManagedCodexConfig(config = {}) {
    const headers = await getAdminApiHeaders();
    const response = await fetch('/api/admin?route=settings/codex-config', {
        method: 'POST',
        headers,
        body: JSON.stringify(config)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || '保存 Codex 配置失败');
    }

    return payload;
}

async function activateCodexAsCurrentAIService(options = {}) {
    const currentService = window.AdminAI?.getPreferredService?.() || window.ADMIN_AI_SERVICE || 'gemini';
    const normalizedCurrentService = window.AdminAI?.normalizeService?.(currentService) || String(currentService || 'gemini').trim().toLowerCase();

    if (normalizedCurrentService !== 'codex') {
        if (typeof window.selectDropdownOption === 'function') {
            window.selectDropdownOption('aiServiceDropdown', 'codex', 'Codex Relay');
        } else {
            setCustomDropdownValue('aiServiceDropdown', 'codex');
            window.ADMIN_AI_SERVICE = 'codex';
            window.AdminAI?.setPreferredService?.('codex');
        }

        if (options.showToast !== false) {
            showToast('已自动切换 AI 分析服务到 Codex Relay。', 'success');
        }
    }

    await checkApiKey();
}

async function testServerManagedCodexConnectivity(config = {}) {
    const headers = await getAdminApiHeaders();
    const response = await fetch('/api/admin?route=settings/codex-config', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            ...config,
            testOnly: true
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || '测试 Codex 连通性失败');
    }

    return payload;
}

async function deleteServerManagedCodexConfig() {
    const headers = await getAdminApiHeaders();
    const response = await fetch('/api/admin?route=settings/codex-config', {
        method: 'DELETE',
        headers
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || '删除 Codex 配置失败');
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

function readCodexDraftConfig() {
    const current = getCodexRuntimeConfig();
    const baseUrlInput = document.getElementById('codexBaseUrlInput');
    const modelInput = document.getElementById('codexModelInput');
    const apiFormatInput = document.getElementById('codexApiFormatInput');

    return {
        baseUrl: normalizeCodexBaseUrl(baseUrlInput?.value || current.baseUrl || ''),
        model: String(modelInput?.value || current.model || DEFAULT_CODEX_CONFIG.model).trim() || DEFAULT_CODEX_CONFIG.model,
        apiFormat: normalizeCodexApiFormat(apiFormatInput?.value || current.apiFormat || DEFAULT_CODEX_CONFIG.apiFormat)
    };
}

function validateCodexDraftConfig(config = {}) {
    const baseUrl = normalizeCodexBaseUrl(config.baseUrl);
    const model = String(config.model || '').trim();

    if (!/^https?:\/\//i.test(baseUrl)) {
        return '请输入有效的 Codex Base URL，例如 https://api.cisct.xyz';
    }

    if (!model) {
        return '请输入有效的 Codex 模型名';
    }

    return '';
}

async function promptForCodexKey(options = {}) {
    const meta = getCodexSourceMeta();
    const draft = options.draft || readCodexDraftConfig();
    const validationMessage = validateCodexDraftConfig(draft);

    if (validationMessage) {
        showToast(validationMessage, 'warning');
        focusCodexConfigPanel();
        return false;
    }

    const helperText = options.helperText || (
        meta.source === 'stored'
            ? '输入新的 Codex / OpenAI 兼容 API Key 将覆盖当前后台安全存储的 Key。'
            : (meta.source === 'environment'
                ? '当前使用的是环境变量。重新录入 Codex Key 后，会连同 Base URL / Model / 接口格式一起切换为后台安全存储。'
                : '首次保存 Codex 中转配置需要同时录入 API Key，提交后会由服务端加密保存。')
    );

    const input = window.prompt(`${helperText}\n\n请输入 Codex / OpenAI 兼容 API Key：`, '');
    if (input === null) {
        return false;
    }

    const apiKey = String(input || '').trim();
    if (!apiKey) {
        showToast('未输入 Codex API Key', 'warning');
        return false;
    }

    try {
        showToast('正在安全保存 Codex 配置...', 'info');
        const payload = await saveServerManagedCodexConfig({
            apiKey,
            ...draft
        });
        setCodexRuntimeConfig(payload);
        await activateCodexAsCurrentAIService();
        renderApiKeySelector();
        renderCodexConfigPanel();
        showToast(payload.message || 'Codex 配置已安全保存到服务端。', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save Codex config:', err);
        showToast(err.message || '保存 Codex 配置失败', 'error');
        return false;
    }
}

async function saveCodexConfig() {
    const draft = readCodexDraftConfig();
    const validationMessage = validateCodexDraftConfig(draft);

    if (validationMessage) {
        showToast(validationMessage, 'warning');
        focusCodexConfigPanel();
        return;
    }

    const config = getCodexRuntimeConfig();
    if ((config.source || 'missing') !== 'stored') {
        await promptForCodexKey({
            draft,
            helperText: '首次固化 Codex 中转配置时，需要同时录入 API Key。后续若只切换中转站地址、模型或接口格式，就可以直接点击“保存 Codex 配置”。'
        });
        return;
    }

    try {
        showToast('正在保存 Codex 配置...', 'info');
        const payload = await saveServerManagedCodexConfig(draft);
        setCodexRuntimeConfig(payload);
        await activateCodexAsCurrentAIService();
        renderApiKeySelector();
        renderCodexConfigPanel();
        showToast(payload.message || 'Codex 配置已更新。', 'success');
    } catch (err) {
        console.error('Failed to update Codex config:', err);
        showToast(err.message || '保存 Codex 配置失败', 'error');
    }
}

async function deleteCodexConfig() {
    const config = getCodexRuntimeConfig();

    if ((config.source || 'missing') !== 'stored') {
        showToast('当前没有可删除的后台存储 Codex 配置。', 'info');
        return;
    }

    if (!confirm('确定要删除当前后台安全存储的 Codex 配置吗？')) {
        return;
    }

    try {
        const payload = await deleteServerManagedCodexConfig();
        setCodexRuntimeConfig(payload);
        renderApiKeySelector();
        renderCodexConfigPanel();
        showToast(payload.message || 'Codex 配置已删除', 'success');
    } catch (err) {
        console.error('Failed to delete Codex config:', err);
        showToast(err.message || '删除 Codex 配置失败', 'error');
    }
}

async function testCodexConnectivity() {
    const draft = readCodexDraftConfig();
    const validationMessage = validateCodexDraftConfig(draft);

    if (validationMessage) {
        showToast(validationMessage, 'warning');
        focusCodexConfigPanel();
        return;
    }

    const runtimeConfig = getCodexRuntimeConfig();
    const canReuseServerKey = Boolean(runtimeConfig.configured && (
        runtimeConfig.source === 'stored'
        || runtimeConfig.source === 'environment'
    ));
    let transientApiKey = '';

    if (!canReuseServerKey) {
        const input = window.prompt(
            '当前还没有可复用的 Codex API Key。\n\n请输入一个仅用于本次连通性测试的 Key；本次测试不会自动保存该 Key。',
            ''
        );

        if (input === null) {
            return;
        }

        transientApiKey = String(input || '').trim();
        if (!transientApiKey) {
            showToast('未输入可用于测试的 Codex API Key', 'warning');
            return;
        }
    }

    try {
        showToast('正在测试 Codex 连通性...', 'info');
        const payload = await testServerManagedCodexConnectivity({
            ...draft,
            ...(transientApiKey ? { apiKey: transientApiKey } : {})
        });
        const responsePreview = String(payload.text || '').trim();
        const detail = responsePreview ? ` 返回：${responsePreview.slice(0, 80)}` : '';
        showToast((payload.message || 'Codex Relay 连通性测试通过。') + detail, 'success');
    } catch (err) {
        console.error('Failed to test Codex connectivity:', err);
        showToast(err.message || '测试 Codex 连通性失败', 'error');
    }
}

function focusCodexConfigPanel() {
    const panel = document.getElementById('codexConfigPanel');
    const baseUrlInput = document.getElementById('codexBaseUrlInput');

    panel?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest'
    });

    if (baseUrlInput) {
        requestAnimationFrame(() => baseUrlInput.focus());
    }
}

function renderCodexConfigPanel() {
    const config = getCodexRuntimeConfig();
    const meta = getCodexSourceMeta();
    const baseUrlInput = document.getElementById('codexBaseUrlInput');
    const modelInput = document.getElementById('codexModelInput');
    const apiFormatInput = document.getElementById('codexApiFormatInput');
    const status = document.getElementById('codexConfigStatus');
    const badge = document.getElementById('codexConfigSourceBadge');
    const deleteButton = document.getElementById('codexDeleteConfigButton');

    if (baseUrlInput) {
        baseUrlInput.value = config.baseUrl || '';
    }

    if (modelInput) {
        modelInput.value = config.model || DEFAULT_CODEX_CONFIG.model;
    }

    if (apiFormatInput) {
        apiFormatInput.value = normalizeCodexApiFormat(config.apiFormat || DEFAULT_CODEX_CONFIG.apiFormat);
    }

    if (badge) {
        badge.textContent = config.configured ? meta.badge : '待配置';
    }

    if (deleteButton) {
        deleteButton.hidden = meta.source !== 'stored';
        deleteButton.disabled = meta.source !== 'stored';
    }

    if (status) {
        const dot = status.querySelector('.status-dot');
        const text = status.querySelector('span:last-child');

        if (config.configured) {
            dot.className = 'status-dot ready';
            text.textContent = meta.statusText;
        } else {
            dot.className = 'status-dot error';
            text.textContent = '未配置 Codex Relay，请先录入 Key 并填写 Base URL / Model / 接口格式';
        }
    }
}

function renderApiKeySelector() {
    const container = document.getElementById('apiKeySelector');
    const settingsList = document.getElementById('settingsApiKeysList');
    const isGeminiReady = Boolean(window.GEMINI_API_KEY);
    const geminiMeta = getGeminiSourceMeta();
    const codexConfig = getCodexRuntimeConfig();
    const codexMeta = getCodexSourceMeta();
    const currentService = window.AdminAI?.getPreferredService?.() || 'gemini';
    const currentServiceLabel = window.AdminAI?.getServiceLabel?.(currentService) || 'AI 服务';
    const currentServiceReady = currentService === 'codex' ? codexConfig.configured : isGeminiReady;
    const currentServiceMeta = currentService === 'codex' ? codexMeta : geminiMeta;
    const currentServiceTitle = currentService === 'codex'
        ? `Codex Relay · ${escapeHtml(codexMeta.title)}`
        : `Gemini Proxy · ${escapeHtml(geminiMeta.title)}`;

    // Render header dropdown (simplified)
    if (container) {
        container.innerHTML = `
            <div class="api-key-dropdown">
                <button class="api-key-current" type="button" data-admin-action="${currentService === 'codex' ? 'settings-focus-codex-config' : 'settings-prompt-api-key'}">
                    <i class="fas fa-shield-alt"></i>
                    <span>${currentServiceReady ? currentServiceTitle : `${escapeHtml(currentServiceLabel)} 未配置`}</span>
                </button>
            </div>
        `;
    }

    // Render settings page key list (full version)
    if (settingsList) {
        settingsList.innerHTML = `
            <div class="api-key-row ${currentService === 'gemini' ? 'active' : ''}" data-index="0">
                <div class="key-info" data-admin-action="settings-prompt-api-key">
                    <span class="key-name-label">Gemini Server Proxy</span>
                    <span class="key-preview-label">${escapeHtml(geminiMeta.preview)}</span>
                </div>
                <div class="key-actions">
                    <span class="key-active-badge">${isGeminiReady ? escapeHtml(geminiMeta.badge) : '待配置'}</span>
                    <button class="btn-add-config btn-add-config--compact" type="button" data-admin-action="settings-prompt-api-key">
                        ${isGeminiReady ? '更新 Key' : '录入 Key'}
                    </button>
                    ${geminiMeta.source === 'stored' ? `
                        <button class="btn-add-config btn-add-config--compact btn-add-config--danger" type="button" data-admin-action="settings-delete-api-key">
                            删除 Key
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="api-key-row ${currentService === 'codex' ? 'active' : ''}" data-index="1">
                <div class="key-info" data-admin-action="settings-focus-codex-config">
                    <span class="key-name-label">Codex Relay</span>
                    <span class="key-preview-label">${escapeHtml(codexMeta.preview)}</span>
                </div>
                <div class="key-actions">
                    <span class="key-active-badge">${codexConfig.configured ? escapeHtml(codexMeta.badge) : '待配置'}</span>
                    <button class="btn-add-config btn-add-config--compact btn-add-config--ghost" type="button" data-admin-action="settings-focus-codex-config">
                        编辑配置
                    </button>
                    <button class="btn-add-config btn-add-config--compact" type="button" data-admin-action="settings-prompt-codex-key">
                        ${codexConfig.configured ? '更新 Key' : '录入 Key'}
                    </button>
                    ${codexMeta.source === 'stored' ? `
                        <button class="btn-add-config btn-add-config--compact btn-add-config--danger" type="button" data-admin-action="settings-delete-codex-config">
                            删除后台配置
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

        if (currentServiceReady) {
            dot.className = 'status-dot ready';
            text.textContent = `当前服务：${currentServiceMeta.statusText}；${currentService === 'codex'
                ? (isGeminiReady ? geminiMeta.statusText : 'Gemini 未配置')
                : (codexConfig.configured ? codexMeta.statusText : 'Codex Relay 未配置')}`;
        } else {
            dot.className = 'status-dot error';
            text.textContent = `当前服务：${currentServiceLabel} 未配置；${currentService === 'codex'
                ? (isGeminiReady ? geminiMeta.statusText : 'Gemini 未配置')
                : (codexConfig.configured ? codexMeta.statusText : 'Codex Relay 未配置')}`;
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

function getCurrentAIServiceLabel() {
    return window.AdminAI?.getServiceLabel?.() || 'AI 服务';
}

function getCurrentAIMissingConfigMessage() {
    return window.AdminAI?.getMissingConfigMessage?.() || '请先在后台完成当前 AI 服务配置';
}

function openCurrentAIConfigEntry() {
    const currentService = window.AdminAI?.getPreferredService?.() || 'gemini';
    if (currentService === 'codex') {
        window.switchModule?.('settings');
        window.switchSettingsView?.('general');
        setTimeout(() => focusCodexConfigPanel(), 0);
        return;
    }

    if (currentService === 'claude') {
        showToast('Claude 暂未接入后台代理，请先切换到 Gemini 或 Codex Relay。', 'info');
        return;
    }

    window.switchModule?.('settings');
    window.switchSettingsView?.('general');
    promptForApiKey();
}

window.addNewApiKey = addNewApiKey;
window.promptForApiKey = promptForApiKey;
window.deleteApiKey = deleteApiKey;
window.promptForCodexKey = promptForCodexKey;
window.saveCodexConfig = saveCodexConfig;
window.testCodexConnectivity = testCodexConnectivity;
window.deleteCodexConfig = deleteCodexConfig;
window.focusCodexConfigPanel = focusCodexConfigPanel;

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
            option.classList.add('selected');
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
            <button class="remove-btn" type="button" data-admin-action="ai-remove-preview" data-preview-index="${index}">
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

async function analyzeImages(options = {}) {
    const settings = options instanceof Event || !options || typeof options !== 'object'
        ? {}
        : options;
    if (uploadedFiles.length === 0) return;

    if (!window.AdminAI?.configured) {
        showToast(getCurrentAIMissingConfigMessage(), 'error');
        await checkApiKey();
        return;
    }

    const loadingEl = document.getElementById('analysisLoading');
    const formEl = document.getElementById('promptForm');
    const btn = document.getElementById('analyzeBtn');

    // Show loading
    setAdminStudioVisibility(loadingEl, true);
    setAdminStudioVisibility(formEl, false);
    btn.disabled = true;
    updateStatus(settings.statusText || 'Analyzing...', 'processing');

    try {
        // Create grid image from all uploaded images (max 6)
        const gridImage = await createImageGrid(uploadedFiles);

        if (!gridImage) {
            throw new Error('无法处理图片');
        }

        // Log grid info
        const imageCount = Math.min(uploadedFiles.length, 6);
        console.log(`🖼️ Analyzing ${imageCount} image(s) as ${imageCount > 1 ? 'grid' : 'single'}`);

        const result = await callAdminVision(gridImage.base64);

        analysisResult = result;
        populateForm(result, { preserveExisting: Boolean(settings.preserveExisting) });

        setAdminStudioVisibility(loadingEl, false);
        setAdminStudioVisibility(formEl, true);
        updateStatus(settings.completeStatusText || 'Analysis Complete', 'ready');
        if (!settings.silentSuccessToast) {
            showToast(`AI 分析完成！(${imageCount} 张图片)`, 'success');
        }
        return result;

    } catch (error) {
        console.error('Analysis error:', error);
        setAdminStudioVisibility(loadingEl, false);
        showToast(`分析失败: ${error.message}`, 'error');
        await checkApiKey();
        if (settings.rethrow) {
            throw error;
        }
        return null;
    } finally {
        btn.disabled = false;
    }
}

async function callAdminVision(imageBase64) {
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
        model: window.AdminAI?.defaultModel || DEFAULT_ADMIN_VISION_MODEL,
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
        throw new Error('No response from AI');
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
    initPromptBilingualFieldToggle();
    setPromptBilingualFieldsOpen(false);
    document.getElementById('promptForm').addEventListener('submit', savePrompt);
}

function setPromptBilingualFieldsOpen(open) {
    const toggleBtn = document.getElementById('promptBilingualToggleBtn');
    const toggleLabel = document.getElementById('promptBilingualToggleLabel');
    const fields = document.getElementById('promptBilingualFields');
    if (!toggleBtn || !toggleLabel || !fields) {
        return;
    }

    const expanded = Boolean(open);
    toggleBtn.classList.toggle('is-active', expanded);
    toggleBtn.dataset.expanded = expanded ? '1' : '0';
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggleLabel.textContent = expanded ? '收起高级语言字段' : '展开高级语言字段';
    setAdminStudioVisibility(fields, expanded);
}

function initPromptBilingualFieldToggle() {
    const toggleBtn = document.getElementById('promptBilingualToggleBtn');
    if (!toggleBtn || toggleBtn.dataset.bound === '1') {
        return;
    }

    toggleBtn.dataset.bound = '1';
    toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        setPromptBilingualFieldsOpen(!expanded);
    });
}

function hasPromptBilingualContent(data = {}) {
    const fields = [
        data.title_zh,
        data.title_en,
        data.description_zh,
        data.description_en,
        data.prompt_text_zh,
        data.prompt_text_en
    ];

    return fields.some((value) => String(value || '').trim().length > 0);
}

function populatePromptBilingualFields(data = {}) {
    document.getElementById('promptTitleZh').value = data.title_zh || '';
    document.getElementById('promptTitleEn').value = data.title_en || '';
    document.getElementById('promptDescriptionZh').value = data.description_zh || '';
    document.getElementById('promptDescriptionEn').value = data.description_en || '';
    document.getElementById('promptTextZh').value = data.prompt_text_zh || '';
    document.getElementById('promptTextEn').value = data.prompt_text_en || '';
}

function collectPromptBilingualFieldValues() {
    return {
        title_zh: document.getElementById('promptTitleZh').value.trim(),
        title_en: document.getElementById('promptTitleEn').value.trim(),
        description_zh: document.getElementById('promptDescriptionZh').value.trim(),
        description_en: document.getElementById('promptDescriptionEn').value.trim(),
        prompt_text_zh: document.getElementById('promptTextZh').value.trim(),
        prompt_text_en: document.getElementById('promptTextEn').value.trim()
    };
}

function resetPromptBilingualFields() {
    populatePromptBilingualFields({});
    setPromptBilingualFieldsOpen(false);
}

function populatePromptOpsFields(data = {}) {
    setCustomDropdownValue('promptOpsStatusDropdown', data.status || '');
    const noteInput = document.getElementById('promptOpsNote');
    if (noteInput) {
        noteInput.value = data.note || '';
    }
}

function collectPromptOpsFieldValues() {
    return normalizePromptAdminOpsData({
        status: document.getElementById('promptOpsStatus')?.value || '',
        note: document.getElementById('promptOpsNote')?.value || ''
    });
}

function resetPromptOpsFields() {
    populatePromptOpsFields({});
}

function clonePromptAiTags(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    try {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return { ...value };
    }
}

function buildPromptAiTagsPayload(existingAiTags = {}, options = {}) {
    const nextAiTags = clonePromptAiTags(existingAiTags);
    const adminOps = normalizePromptAdminOpsData(options.adminOps || {});
    const analysisData = options.analysisResult && typeof options.analysisResult === 'object' ? options.analysisResult : null;

    if (analysisData) {
        nextAiTags.objects = analysisData.objects;
        nextAiTags.scenes = analysisData.scenes;
        nextAiTags.styles = analysisData.styles;
        nextAiTags.mood = analysisData.mood;
    }

    if (adminOps.status || adminOps.note) {
        nextAiTags.admin = adminOps;
    } else {
        delete nextAiTags.admin;
    }

    return Object.keys(nextAiTags).length > 0 ? nextAiTags : undefined;
}

const PROMPT_CATEGORY_VALUE_ALIASES = Object.freeze({
    photography: 'Photography',
    photo: 'Photography',
    photograph: 'Photography',
    '摄影': 'Photography',
    illustration: 'Illustration',
    '插画': 'Illustration',
    '插图': 'Illustration',
    '3d art': '3D Art',
    '3d': '3D Art',
    '3d艺术': '3D Art',
    '3d 艺术': '3D Art',
    '三维': '3D Art',
    '立体': '3D Art',
    miniature: 'Miniature',
    mini: 'Miniature',
    micro: 'Miniature',
    '微缩': 'Miniature',
    creative: 'Creative',
    '创意': 'Creative',
    animation: 'Animation',
    cartoon: 'Animation',
    '动画': 'Animation'
});

const PROMPT_CATEGORY_INFERENCE_KEYWORDS = Object.freeze({
    Photography: ['photography', 'photograph', 'photo', 'camera', 'portrait', 'landscape', 'editorial', 'cinematic photo', '摄影', '拍摄', '照片', '写实摄影'],
    Illustration: ['illustration', 'illustrated', 'drawing', 'sketch', 'painting', 'watercolor', 'poster', '插画', '插图', '绘画', '手绘'],
    '3D Art': ['3d', '3d art', 'render', 'rendering', 'cgi', 'octane', 'blender', 'unreal', '三维', '立体', '渲染', '建模'],
    Miniature: ['miniature', 'diorama', 'tilt-shift', 'micro', 'tiny', '微缩', '微观', '模型场景'],
    Animation: ['animation', 'animated', 'animatic', 'storyboard', 'cartoon', 'cel', 'motion', '动画', '卡通', '分镜'],
    Creative: ['creative', 'concept', 'conceptual', 'branding', 'packaging', 'product design', 'abstract', 'mixed media', '创意', '概念', '包装']
});

const PROMPT_CATEGORY_FALLBACK_TITLES = Object.freeze({
    Photography: 'Photography Prompt',
    Illustration: 'Illustration Prompt',
    '3D Art': '3D Art Prompt',
    Miniature: 'Miniature Prompt',
    Animation: 'Animation Prompt',
    Creative: 'Creative Prompt'
});

function normalizePromptCategoryValue(value = '') {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
        return '';
    }

    const normalizedKey = rawValue.toLowerCase();
    if (PROMPT_CATEGORY_VALUE_ALIASES[normalizedKey]) {
        return PROMPT_CATEGORY_VALUE_ALIASES[normalizedKey];
    }

    const categoryDropdown = document.getElementById('categoryDropdown');
    const options = Array.from(categoryDropdown?.querySelectorAll('.select-option') || []);
    const exactMatch = options.find((option) => String(option.dataset.value || '').trim() === rawValue);
    if (exactMatch) {
        return String(exactMatch.dataset.value || '').trim();
    }

    const textMatch = options.find((option) => String(option.textContent || '').trim().toLowerCase() === normalizedKey);
    if (textMatch) {
        return String(textMatch.dataset.value || '').trim();
    }

    return '';
}

function inferPromptCategoryValue(analysisData = {}) {
    const directCategory = normalizePromptCategoryValue(analysisData.category || analysisData.tags?.[0] || '');
    if (directCategory) {
        return directCategory;
    }

    const keywordSource = [
        analysisData.category,
        analysisData.title,
        analysisData.title_en,
        analysisData.title_zh,
        analysisData.description,
        analysisData.description_en,
        analysisData.description_zh,
        analysisData.prompt_text,
        analysisData.prompt,
        analysisData.prompt_suggestion_en,
        analysisData.prompt_suggestion_zh,
        ...(analysisData.styles?.en || []),
        ...(analysisData.styles?.zh || []),
        ...(analysisData.scenes?.en || []),
        ...(analysisData.scenes?.zh || []),
        ...(analysisData.objects?.en || []),
        ...(analysisData.objects?.zh || [])
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');

    if (!keywordSource) {
        return '';
    }

    for (const [category, keywords] of Object.entries(PROMPT_CATEGORY_INFERENCE_KEYWORDS)) {
        if (keywords.some((keyword) => keywordSource.includes(String(keyword).toLowerCase()))) {
            return category;
        }
    }

    return 'Creative';
}

function buildPromptCategoryInferenceSource(formValues = {}, analysisData = {}) {
    return {
        ...analysisData,
        title: formValues.title || analysisData.title || analysisData.title_en || analysisData.title_zh || '',
        title_en: analysisData.title_en || (!promptHasVisibleCopy(analysisData.title_en) && formValues.title && !/[\u4e00-\u9fff]/.test(formValues.title) ? formValues.title : ''),
        title_zh: analysisData.title_zh || (!promptHasVisibleCopy(analysisData.title_zh) && formValues.title && /[\u4e00-\u9fff]/.test(formValues.title) ? formValues.title : ''),
        description: formValues.description || analysisData.description || analysisData.description_en || analysisData.description_zh || '',
        description_en: analysisData.description_en || (!promptHasVisibleCopy(analysisData.description_en) && formValues.description && !/[\u4e00-\u9fff]/.test(formValues.description) ? formValues.description : ''),
        description_zh: analysisData.description_zh || (!promptHasVisibleCopy(analysisData.description_zh) && formValues.description && /[\u4e00-\u9fff]/.test(formValues.description) ? formValues.description : ''),
        prompt_text: formValues.prompt || analysisData.prompt_text || analysisData.prompt || analysisData.prompt_suggestion_en || analysisData.prompt_suggestion_zh || '',
        prompt: formValues.prompt || analysisData.prompt || analysisData.prompt_text || '',
        prompt_suggestion_en: analysisData.prompt_suggestion_en || (!promptHasVisibleCopy(analysisData.prompt_suggestion_en) && formValues.prompt && !/[\u4e00-\u9fff]/.test(formValues.prompt) ? formValues.prompt : ''),
        prompt_suggestion_zh: analysisData.prompt_suggestion_zh || (!promptHasVisibleCopy(analysisData.prompt_suggestion_zh) && formValues.prompt && /[\u4e00-\u9fff]/.test(formValues.prompt) ? formValues.prompt : '')
    };
}

function buildPromptFallbackTitle(formValues = {}, analysisData = {}, category = '') {
    const candidates = [
        analysisData.title,
        analysisData.title_en,
        analysisData.title_zh,
        analysisData.description,
        analysisData.description_en,
        analysisData.description_zh,
        formValues.prompt,
        analysisData.prompt,
        analysisData.prompt_text,
        analysisData.prompt_suggestion_en,
        analysisData.prompt_suggestion_zh
    ];

    for (const candidate of candidates) {
        const trimmed = String(candidate || '').replace(/\s+/g, ' ').trim();
        if (!trimmed) {
            continue;
        }

        const normalized = trimmed
            .replace(/[.。!！?？,:：;；]+$/g, '')
            .slice(0, 80)
            .trim();
        if (normalized) {
            return normalized;
        }
    }

    return PROMPT_CATEGORY_FALLBACK_TITLES[category] || PROMPT_CATEGORY_FALLBACK_TITLES.Creative;
}

function getPromptFormSnapshot() {
    return {
        title: document.getElementById('promptTitle')?.value.trim() || '',
        category: document.getElementById('promptCategory')?.value || '',
        prompt: document.getElementById('promptText')?.value.trim() || '',
        description: document.getElementById('promptDescription')?.value.trim() || '',
        opsStatus: document.getElementById('promptOpsStatus')?.value || '',
        opsNote: document.getElementById('promptOpsNote')?.value || '',
        bilingual: collectPromptBilingualFieldValues()
    };
}

function resolvePromptPrimaryFields(formValues = {}, analysisData = {}) {
    const categoryInferenceSource = buildPromptCategoryInferenceSource(formValues, analysisData);
    const resolvedCategory = normalizePromptCategoryValue(
        formValues.category
        || analysisData.category
        || analysisData.tags?.[0]
        || categoryInferenceSource.category
        || ''
    ) || inferPromptCategoryValue(categoryInferenceSource);
    const resolvedTitle = formValues.title
        || analysisData.title
        || analysisData.title_en
        || analysisData.title_zh
        || buildPromptFallbackTitle(formValues, analysisData, resolvedCategory);
    const resolvedPromptText = formValues.prompt
        || analysisData.prompt_text
        || analysisData.prompt
        || analysisData.prompt_suggestion_en
        || analysisData.prompt_suggestion_zh
        || '';
    const resolvedDescription = formValues.description
        || analysisData.description
        || analysisData.description_en
        || analysisData.description_zh
        || '';

    return {
        title: resolvedTitle,
        category: resolvedCategory,
        promptText: resolvedPromptText,
        description: resolvedDescription
    };
}

function populateForm(data, options = {}) {
    const preserveExisting = Boolean(options.preserveExisting);
    const currentForm = preserveExisting ? getPromptFormSnapshot() : null;
    const resolvedPrimaryFields = resolvePromptPrimaryFields(currentForm || {}, data || {});

    // Title
    document.getElementById('promptTitle').value = resolvedPrimaryFields.title;

    // Category
    setCustomDropdownValue('categoryDropdown', resolvedPrimaryFields.category);

    // Prompt text
    document.getElementById('promptText').value = resolvedPrimaryFields.promptText;

    // Description
    document.getElementById('promptDescription').value = resolvedPrimaryFields.description;

    const nextBilingualValues = {
        title_zh: preserveExisting && promptHasVisibleCopy(currentForm?.bilingual?.title_zh)
            ? currentForm.bilingual.title_zh
            : (data.title_zh || ''),
        title_en: preserveExisting && promptHasVisibleCopy(currentForm?.bilingual?.title_en)
            ? currentForm.bilingual.title_en
            : (data.title_en || ''),
        description_zh: preserveExisting && promptHasVisibleCopy(currentForm?.bilingual?.description_zh)
            ? currentForm.bilingual.description_zh
            : (data.description_zh || ''),
        description_en: preserveExisting && promptHasVisibleCopy(currentForm?.bilingual?.description_en)
            ? currentForm.bilingual.description_en
            : (data.description_en || ''),
        prompt_text_zh: preserveExisting && promptHasVisibleCopy(currentForm?.bilingual?.prompt_text_zh)
            ? currentForm.bilingual.prompt_text_zh
            : (data.prompt_text_zh || data.prompt_suggestion_zh || ''),
        prompt_text_en: preserveExisting && promptHasVisibleCopy(currentForm?.bilingual?.prompt_text_en)
            ? currentForm.bilingual.prompt_text_en
            : (data.prompt_text_en || data.prompt_suggestion_en || '')
    };

    populatePromptBilingualFields(nextBilingualValues);
    setPromptBilingualFieldsOpen(hasPromptBilingualContent(nextBilingualValues));
    populatePromptOpsFields({
        status: preserveExisting && currentForm?.opsStatus ? currentForm.opsStatus : (data.opsStatus || ''),
        note: preserveExisting && currentForm?.opsNote ? currentForm.opsNote : (data.opsNote || '')
    });

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
        container.replaceChildren(createAdminStudioEmptyElement('No tags', 'admin-empty-tag', 'span'));
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

    const colorClassMap = Object.fromEntries(
        Object.keys(colorMap).map((name) => [
            name,
            `color-swatch--${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        ])
    );

    container.innerHTML = colors.map(color => {
        const swatchClass = colorClassMap[color.toLowerCase()] || 'color-swatch--unknown';
        return `<div class="color-swatch ${swatchClass}" data-color="${color}"></div>`;
    }).join('');
}

async function savePrompt(e) {
    e.preventDefault();

    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ formId: 'promptForm' });
    if (!writableSite) {
        return;
    }

    let activeAnalysisResult = analysisResult;

    // For new prompts, auto-analyze on save when needed. For editing, just need images.
    if (currentMode === 'create') {
        if (uploadedFiles.length === 0) {
            showToast('请先上传图片', 'error');
            return;
        }
        if (!activeAnalysisResult) {
            showToast('未检测到分析结果，正在自动分析并保存...', 'warning');
            activeAnalysisResult = await analyzeImages({
                preserveExisting: true,
                silentSuccessToast: true,
                rethrow: true,
                statusText: 'Auto Analyzing...',
                completeStatusText: 'Analysis Complete'
            });
            if (!activeAnalysisResult) {
                throw new Error('请先完成 AI 分析');
            }
        }
    } else if (currentMode === 'edit') {
        // When editing, we don't need new analysis - just images
        if (uploadedFiles.length === 0 && currentEditingPromptImageUrls.length === 0) {
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
        const formValues = getPromptFormSnapshot();
        const resolvedPrimaryFields = resolvePromptPrimaryFields(formValues, activeAnalysisResult || {});
        let title = resolvedPrimaryFields.title;
        let category = resolvedPrimaryFields.category;
        const promptText = resolvedPrimaryFields.promptText;
        const description = resolvedPrimaryFields.description;
        const bilingualValues = collectPromptBilingualFieldValues();
        const promptOps = collectPromptOpsFieldValues();

        if (title && document.getElementById('promptTitle').value.trim() !== title) {
            document.getElementById('promptTitle').value = title;
        }

        if (category && document.getElementById('promptCategory').value !== category) {
            setCustomDropdownValue('categoryDropdown', category);
        }

        if (promptText && document.getElementById('promptText').value.trim() !== promptText) {
            document.getElementById('promptText').value = promptText;
        }

        if (description && document.getElementById('promptDescription').value.trim() !== description) {
            document.getElementById('promptDescription').value = description;
        }

        if (!title || !category) {
            const missingFields = [];
            if (!title) {
                missingFields.push('标题');
            }
            if (!category) {
                missingFields.push('分类');
            }
            throw new Error(`请填写${missingFields.join('和')}`);
        }

        // Try to upload images to Supabase Storage
        let imageUrls = [];
        let storageAvailable = true;
        const retainedEditingImageUrls = currentMode === 'edit'
            ? currentEditingPromptImageUrls.map((url) => String(url || '').trim()).filter(Boolean)
            : [];

        try {
            if (uploadedFiles.length === 0 && retainedEditingImageUrls.length > 0) {
                imageUrls = retainedEditingImageUrls;
            } else {
                imageUrls = await uploadImages();
            }
            progress = Math.min(progress + 3, 27);
            updateDotProgress(progress);
        } catch (storageError) {
            console.warn('Storage upload failed:', storageError);
            storageAvailable = false;
            // Keep existing images when storage fails in edit mode
            imageUrls = retainedEditingImageUrls;
        }

        // Create prompt object
        // In edit mode without new analysis, preserve existing values by not including them
        const promptData = {
            title: title,
            tags: [category],
            description: description,
            prompt: promptText,
            images: imageUrls,
            ...bilingualValues
        };

        // Only include AI analysis data if we have it (new analysis was run)
        if (activeAnalysisResult) {
            promptData.dominantColors = activeAnalysisResult.dominantColors || [];
            // Bilingual fields from AI analysis
            promptData.title_en = promptData.title_en || activeAnalysisResult.title_en || activeAnalysisResult.title || title;
            promptData.title_zh = promptData.title_zh || activeAnalysisResult.title_zh || '';
            promptData.description_en = promptData.description_en || activeAnalysisResult.description_en || activeAnalysisResult.description || description;
            promptData.description_zh = promptData.description_zh || activeAnalysisResult.description_zh || '';
            promptData.prompt_text_en = promptData.prompt_text_en || activeAnalysisResult.prompt_suggestion_en || '';
            promptData.prompt_text_zh = promptData.prompt_text_zh || activeAnalysisResult.prompt_suggestion_zh || '';
        }

        // Auto-seed and translate missing bilingual fields using PromptTranslator.
        // Single-save should try to complete all missing zh/en fields, not just establish minimal coverage.
        let translationSoftFailed = false;
        const bilingualCoverageInput = {
            title: promptData.title,
            description: promptData.description,
            prompt_text: promptData.prompt,
            title_zh: promptData.title_zh,
            title_en: promptData.title_en,
            description_zh: promptData.description_zh,
            description_en: promptData.description_en,
            prompt_text_zh: promptData.prompt_text_zh,
            prompt_text_en: promptData.prompt_text_en
        };

        if (window.PromptTranslator?.seedCoverageFields) {
            const seededCoverageFields = PromptTranslator.seedCoverageFields(bilingualCoverageInput);
            promptData.title_zh = promptData.title_zh || seededCoverageFields.title_zh || '';
            promptData.title_en = promptData.title_en || seededCoverageFields.title_en || '';
            promptData.description_zh = promptData.description_zh || seededCoverageFields.description_zh || '';
            promptData.description_en = promptData.description_en || seededCoverageFields.description_en || '';
            promptData.prompt_text_zh = promptData.prompt_text_zh || seededCoverageFields.prompt_text_zh || '';
            promptData.prompt_text_en = promptData.prompt_text_en || seededCoverageFields.prompt_text_en || '';
        }

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

                const translatedFields = await PromptTranslator.translatePromptFields({
                    title: promptData.title,
                    description: promptData.description,
                    prompt_text: promptData.prompt,
                    title_zh: promptData.title_zh,
                    title_en: promptData.title_en,
                    description_zh: promptData.description_zh,
                    description_en: promptData.description_en,
                    prompt_text_zh: promptData.prompt_text_zh,
                    prompt_text_en: promptData.prompt_text_en
                }, { mode: 'full' });

                promptData.title_zh = promptData.title_zh || translatedFields.title_zh || '';
                promptData.title_en = promptData.title_en || translatedFields.title_en || '';
                promptData.description_zh = promptData.description_zh || translatedFields.description_zh || '';
                promptData.description_en = promptData.description_en || translatedFields.description_en || '';
                promptData.prompt_text_zh = promptData.prompt_text_zh || translatedFields.prompt_text_zh || '';
                promptData.prompt_text_en = promptData.prompt_text_en || translatedFields.prompt_text_en || '';

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
                translationSoftFailed = true;
            }
        }

        promptData.aiTags = buildPromptAiTagsPayload(currentEditingPromptAiTags, {
            analysisResult: activeAnalysisResult,
            adminOps: promptOps
        });

        // Always save to Supabase database (storage availability doesn't matter for DB save)
        let savedRow = null;
        let missingPersistedBilingualFields = [];
        let bilingualPersistenceState = {
            row: null,
            missingFields: [],
            schemaMissing: false,
            verificationError: null
        };
        const promptPayload = {
            title: promptData.title,
            tags: promptData.tags,
            description: promptData.description,
            prompt_text: promptData.prompt,
            title_en: promptData.title_en || '',
            title_zh: promptData.title_zh || '',
            description_en: promptData.description_en || '',
            description_zh: promptData.description_zh || '',
            prompt_text_en: promptData.prompt_text_en || '',
            prompt_text_zh: promptData.prompt_text_zh || ''
        };

        if (storageAvailable) {
            promptPayload.images = promptData.images;
        }

        if (promptData.dominantColors) {
            promptPayload.dominant_colors = promptData.dominantColors;
        }

        if (promptData.aiTags) {
            promptPayload.ai_tags = promptData.aiTags;
        }

        if (currentMode === 'edit' && editingId) {
            const payload = await mutateAdminPrompt({
                action: 'update',
                site: writableSite,
                id: editingId,
                payload: promptPayload
            });
            savedRow = payload.row || null;
        } else {
            const payload = await mutateAdminPrompt({
                action: 'create',
                site: writableSite,
                payload: {
                    ...promptPayload,
                    images: promptData.images,
                    dominant_colors: promptData.dominantColors,
                    ai_tags: promptData.aiTags
                }
            });
            savedRow = payload.row || null;
        }

        if (!savedRow) {
            throw new Error('Prompt save did not return a row');
        }

        const savedPromptId = String(savedRow.id || editingId || '').trim();
        bilingualPersistenceState = await verifyPromptPersistedBilingualFields(savedPromptId, promptPayload, savedRow);
        savedRow = bilingualPersistenceState.row || savedRow;
        missingPersistedBilingualFields = bilingualPersistenceState.missingFields;

        if (savedPromptId) {
            queueAdminGalleryPromptFocus(savedPromptId);
        }
        try {
            await loadAdminPrompts();
        } catch (refreshError) {
            console.warn('[Gallery] Prompt saved but manage list refresh failed:', refreshError);
        }
        if (savedRow?.id) {
            hydrateAdminGalleryPromptsLocally([savedRow]);
        }

        const successMsg = currentMode === 'edit' ? 'Prompt updated!' : 'Prompt saved!';
        showToast(successMsg, 'success');

        const savedCoverage = getPromptLanguageCoverage(savedRow);
        const bilingualPersistenceWarning = buildPromptBilingualPersistenceWarningMessage(
            missingPersistedBilingualFields,
            bilingualPersistenceState
        );
        if (bilingualPersistenceWarning) {
            showToast(bilingualPersistenceWarning, 'warning');
        } else if (!savedCoverage.zh || !savedCoverage.en || translationSoftFailed) {
            showToast('Prompt 已保存，但双语仍未补全。可在高级语言字段中继续校对补齐。', 'warning');
        }

        // Reset edit mode
        if (currentMode === 'edit') {
            cancelEdit();
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
        const client = getAdminStudioSupabaseClient();
        try {
            // Get current session
            const { data: { session } } = await client.auth.getSession();

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

            const originalImagesToUpload = imagesToUpload.filter(({ isThumb }) => !isThumb);

            for (let i = 0; i < originalImagesToUpload.length; i++) {
                const { base64, filename } = originalImagesToUpload[i];

                try {
                    // Convert base64 to blob
                    const blob = await fetch(`data:image/webp;base64,${base64}`).then(r => r.blob());

                    const { data, error } = await client.storage
                        .from('prompt-images')
                        .upload(filename, blob, {
                            contentType: 'image/webp',
                            cacheControl: '31536000',
                            upsert: false
                        });

                    if (error) throw error;

                    // Get public URL
                    const { data: urlData } = client.storage
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
    if (state === 'error' && /missing$/i.test(String(text || ''))) {
        statusEl.classList.add('clickable');
        statusEl.title = '点击查看当前 AI 服务配置';
        statusEl.onclick = () => openCurrentAIConfigEntry();
    } else {
        statusEl.classList.remove('clickable');
        statusEl.title = '';
        statusEl.onclick = null;
    }
}

function setToastContent(toast, message, type = 'info') {
    if (!toast) return;
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'triangle-exclamation' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
}

function dismissToast(toast) {
    if (!toast || toast.dataset.dismissing === 'true') return;
    toast.dataset.dismissing = 'true';
    if (toast._dismissTimer) {
        clearTimeout(toast._dismissTimer);
        toast._dismissTimer = null;
    }
    toast.classList.add('is-dismissing');
    setTimeout(() => toast.remove(), 300);
}

function scheduleToastDismiss(toast, durationMs = 3000) {
    if (!toast) return;
    if (toast._dismissTimer) {
        clearTimeout(toast._dismissTimer);
        toast._dismissTimer = null;
    }
    const normalizedDuration = Number(durationMs);
    if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
        return;
    }
    toast._dismissTimer = setTimeout(() => dismissToast(toast), normalizedDuration);
}

function showToast(message, type = 'info', options = {}) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const durationMs = Number.isFinite(Number(options?.durationMs)) ? Number(options.durationMs) : 3000;
    setToastContent(toast, message, type);
    container.appendChild(toast);
    scheduleToastDismiss(toast, durationMs);
    return toast;
}

function withTimeout(promise, timeoutMs = 20000, timeoutMessage = '操作超时') {
    const normalizedTimeout = Number(timeoutMs);
    if (!Number.isFinite(normalizedTimeout) || normalizedTimeout <= 0) {
        return Promise.resolve(promise);
    }

    let timerId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, normalizedTimeout);
    });

    return Promise.race([
        Promise.resolve(promise).finally(() => {
            if (timerId) {
                clearTimeout(timerId);
                timerId = null;
            }
        }),
        timeoutPromise
    ]);
}

function resetForm() {
    uploadedFiles = [];
    analysisResult = null;
    currentEditingPromptAiTags = null;
    currentEditingPromptImageUrls = [];
    document.getElementById('previewGrid').innerHTML = '';
    setAdminStudioVisibility(document.getElementById('promptForm'), false);
    document.getElementById('promptForm').reset();
    resetPromptBilingualFields();
    resetPromptOpsFields();
    document.getElementById('tagObjects').innerHTML = '';
    document.getElementById('tagScenes').innerHTML = '';
    document.getElementById('tagStyles').innerHTML = '';
    document.getElementById('tagMood').innerHTML = '';
    document.getElementById('colorSwatches').innerHTML = '';

    // Hide last edited info
    const lastEditedInfo = document.getElementById('lastEditedInfo');
    setAdminStudioVisibility(lastEditedInfo, false);

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
let activeGalleryBatchInteraction = null;
const GALLERY_BATCH_INTERACTION_MIN_MS = 260;

function setGalleryBatchPromptCardsPending(isPending, label = '') {
    const selectedIds = Array.from(selectedPrompts || []);
    if (!selectedIds.length) {
        return;
    }

    selectedIds.forEach((id) => {
        const card = document.querySelector(`.admin-card[data-id="${CSS.escape(String(id))}"]`);
        if (!card) {
            return;
        }

        card.classList.toggle('is-batch-pending', Boolean(isPending));
        if (isPending && label) {
            card.dataset.batchPendingLabel = label;
        } else {
            delete card.dataset.batchPendingLabel;
        }
    });
}

function beginGalleryBatchMenuInteraction(actionEl, options = {}) {
    const menuItem = actionEl?.closest?.('.batch-menu-item');
    if (!menuItem) {
        return () => {};
    }

    if (activeGalleryBatchInteraction?.cleanup) {
        activeGalleryBatchInteraction.cleanup({ closeMenu: false });
    }

    const pendingLabel = String(options.pendingLabel || '').trim() || '正在处理...';
    const menuContainer = document.getElementById('batchMenuContainer');
    const menuTrigger = document.getElementById('batchMenuTrigger');
    const countWrapper = document.getElementById('promptCountWrapper');
    const feedbackEl = document.getElementById('batchActionFeedback');
    const menuItems = Array.from(document.querySelectorAll('#batchDropdownMenu .batch-menu-item'));
    const labelEl = menuItem.querySelector('span');
    const iconEl = menuItem.querySelector('i');
    const originalIconClass = iconEl?.className || '';

    menuContainer?.classList.add('open', 'is-busy');
    if (menuContainer) {
        menuContainer.dataset.busy = 'true';
    }
    if (menuTrigger) {
        menuTrigger.disabled = true;
        menuTrigger.classList.add('is-busy');
    }

    menuItems.forEach((item) => {
        const isCurrent = item === menuItem;
        item.classList.toggle('is-pending', isCurrent);
        if (!isCurrent) {
            item.classList.add('is-disabled');
            item.setAttribute('aria-disabled', 'true');
        } else {
            item.removeAttribute('aria-disabled');
        }
    });

    if (iconEl) {
        iconEl.className = 'fas fa-spinner fa-spin';
    }

    if (countWrapper) {
        countWrapper.dataset.batchBusy = 'true';
    }
    if (feedbackEl) {
        feedbackEl.hidden = false;
        feedbackEl.textContent = pendingLabel;
    }

    setGalleryBatchPromptCardsPending(true, pendingLabel);

    const cleanup = ({ closeMenu = true } = {}) => {
        menuItems.forEach((item) => {
            item.classList.remove('is-pending', 'is-disabled');
            item.removeAttribute('aria-disabled');
        });

        if (iconEl && originalIconClass) {
            iconEl.className = originalIconClass;
        }

        if (menuTrigger) {
            menuTrigger.disabled = false;
            menuTrigger.classList.remove('is-busy');
        }

        if (menuContainer) {
            delete menuContainer.dataset.busy;
            menuContainer.classList.remove('is-busy');
        }

        if (countWrapper) {
            delete countWrapper.dataset.batchBusy;
        }
        if (feedbackEl) {
            feedbackEl.hidden = true;
            feedbackEl.textContent = '';
        }

        setGalleryBatchPromptCardsPending(false);

        if (closeMenu) {
            closeBatchMenu(true);
        }

        activeGalleryBatchInteraction = null;
    };

    activeGalleryBatchInteraction = {
        menuItem,
        cleanup
    };

    return cleanup;
}

async function runGalleryBatchActionFromMenu(actionEl, operation, options = {}) {
    if (typeof operation !== 'function') {
        return false;
    }

    const cleanup = beginGalleryBatchMenuInteraction(actionEl, options);
    const startedAt = Date.now();

    try {
        return await operation();
    } finally {
        const elapsed = Date.now() - startedAt;
        const remaining = GALLERY_BATCH_INTERACTION_MIN_MS - elapsed;
        if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
        }
        cleanup({ closeMenu: options.closeMenu !== false });
    }
}

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
    document.getElementById('batchLocalizeMenuItem')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void runGalleryBatchActionFromMenu(e.currentTarget, () => batchCompleteSelectedPromptBilingualFields(), {
            pendingLabel: '正在补全双语...'
        });
    });
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
    if (!container || container.dataset.busy === 'true') {
        return;
    }
    container.classList.toggle('open');
}

function closeBatchMenu(force = false) {
    const container = document.getElementById('batchMenuContainer');
    if (!container) {
        return;
    }
    if (!force && container.dataset.busy === 'true') {
        return;
    }
    container.classList.remove('open');
}

// Select all prompts (only visible cards)
function selectAllPrompts() {
    // Only select cards that are NOT hidden by search filter
    const cards = document.querySelectorAll('.admin-card:not(.admin-card--hidden-by-search):not(.admin-card--hidden-by-pagination)');
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
        setAdminStudioVisibility(batchMenuContainer, true);
        batchMenuContainer.classList.add('open'); // Auto-open dropdown
        attachCardSelectionListeners();
    } else {
        setAdminStudioVisibility(batchMenuContainer, false);
        batchMenuContainer.classList.remove('open');
        selectedPrompts.clear();
        document.querySelectorAll('.admin-card.selected').forEach(card => {
            card.classList.remove('selected');
        });
        // Hide count when exiting select mode
        setAdminStudioVisibility(promptCountWrapper, false);
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
    setAdminStudioVisibility(promptCountWrapper, count > 0);
}

// Get selected prompts data
function getSelectedPromptsData() {
    return allPrompts.filter(p => selectedPrompts.has(String(p.id))); // 将ID转为字符串比较
}

function buildPromptBilingualCompletionSource(prompt = {}) {
    return {
        title: String(prompt.title || prompt.title_en || prompt.title_zh || '').trim(),
        description: String(prompt.description || prompt.description_en || prompt.description_zh || '').trim(),
        prompt_text: String(prompt.prompt_text || prompt.prompt || prompt.prompt_text_en || prompt.prompt_text_zh || '').trim(),
        title_zh: String(prompt.title_zh || '').trim(),
        title_en: String(prompt.title_en || '').trim(),
        description_zh: String(prompt.description_zh || '').trim(),
        description_en: String(prompt.description_en || '').trim(),
        prompt_text_zh: String(prompt.prompt_text_zh || '').trim(),
        prompt_text_en: String(prompt.prompt_text_en || '').trim()
    };
}

function buildPromptBilingualCoveragePatch(prompt = {}, translatedFields = {}) {
    const nextFields = {
        title_zh: String(translatedFields.title_zh || prompt.title_zh || '').trim(),
        title_en: String(translatedFields.title_en || prompt.title_en || '').trim(),
        description_zh: String(translatedFields.description_zh || prompt.description_zh || '').trim(),
        description_en: String(translatedFields.description_en || prompt.description_en || '').trim(),
        prompt_text_zh: String(translatedFields.prompt_text_zh || prompt.prompt_text_zh || '').trim(),
        prompt_text_en: String(translatedFields.prompt_text_en || prompt.prompt_text_en || '').trim()
    };

    const payload = {};

    Object.entries(nextFields).forEach(([field, nextValue]) => {
        const previousValue = String(prompt[field] || '').trim();
        if (nextValue !== previousValue) {
            payload[field] = nextValue;
        }
    });

    const nextCoverage = getPromptLanguageCoverage({
        ...prompt,
        ...nextFields
    });

    return {
        payload,
        nextCoverage
    };
}

function requireSelectedPromptsForBatch(label = '批量操作') {
    const selected = getSelectedPromptsData();
    if (selected.length > 0) {
        return selected;
    }

    showToast(`请先选择要执行「${label}」的 Prompt`, 'error');
    return null;
}

async function batchSetSelectedPromptStatus(nextStatus = '') {
    const normalizedStatus = String(nextStatus || '').trim().toLowerCase();
    const statusLabel = normalizedStatus
        ? (PROMPT_ADMIN_STATUS_LABELS[normalizedStatus] || normalizedStatus)
        : '清除运营状态';
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({
        label: normalizedStatus ? `批量设为 ${statusLabel}` : statusLabel
    });
    if (!writableSite) {
        return false;
    }

    const selected = requireSelectedPromptsForBatch(normalizedStatus ? `批量设为 ${statusLabel}` : statusLabel);
    if (!selected) {
        return false;
    }

    const tasks = selected.map(async (prompt) => {
        const currentAiTags = clonePromptAiTags(prompt.ai_tags || prompt.aiTags || {});
        const currentOps = getPromptAdminOpsData(prompt);
        const nextAiTags = buildPromptAiTagsPayload(currentAiTags, {
            adminOps: {
                ...currentOps,
                status: normalizedStatus
            }
        });

        return mutateAdminPrompt({
            action: 'patch',
            site: writableSite,
            id: prompt.id,
            payload: {
                ai_tags: nextAiTags || {}
            }
        });
    });

    const results = await Promise.allSettled(tasks);
    const successCount = results.filter((item) => item.status === 'fulfilled').length;
    const failureCount = results.length - successCount;

    if (successCount > 0) {
        await loadAdminPrompts();
    }

    if (failureCount > 0) {
        showToast(`${statusLabel} 已更新 ${successCount} 条，失败 ${failureCount} 条`, successCount > 0 ? 'warning' : 'error');
        return false;
    }

    showToast(`${statusLabel} 已更新 ${successCount} 条 Prompt`, 'success');
    return true;
}

async function batchAddSelectedPromptsToHomepage() {
    const selected = requireSelectedPromptsForBatch('批量加入首页精选');
    if (!selected) {
        return false;
    }

    try {
        await window.HomepageAdmin?.addFeaturedPrompts?.(selected);
        await loadAdminPrompts();
        return true;
    } catch (error) {
        console.error('[Gallery] Failed to batch add prompts to homepage:', error);
        showToast(`批量加入首页失败: ${error.message || '未知错误'}`, 'error');
        return false;
    }
}

async function batchCompleteSelectedPromptBilingualFields() {
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ action: 'gallery-batch-localize' });
    if (!writableSite) {
        return false;
    }

    const selected = requireSelectedPromptsForBatch('批量补全双语');
    if (!selected) {
        return false;
    }

    const progressToast = showToast(`正在为 ${selected.length} 条 Prompt 补全双语...`, 'info', { durationMs: 0 });
    const finalizeProgressToast = (message, type = 'info', durationMs = 4200) => {
        if (progressToast && progressToast.isConnected) {
            setToastContent(progressToast, message, type);
            scheduleToastDismiss(progressToast, durationMs);
            return;
        }
        showToast(message, type, { durationMs });
    };

    if (!window.PromptTranslator || !window.AdminAI?.configured) {
        finalizeProgressToast('请先配置可用的 AI 翻译服务，再执行批量补全双语。', 'error');
        await checkApiKey();
        return false;
    }

    let localizedCount = 0;
    let unchangedCount = 0;
    let incompleteCount = 0;
    let failedCount = 0;
    let persistenceBlockedCount = 0;
    let persistenceWarningDetail = '';
    let processedCount = 0;
    const failureMessages = [];
    const localizedRows = [];

    for (const prompt of selected) {
        try {
            const translationSource = buildPromptBilingualCompletionSource(prompt);
            const translatedFields = await withTimeout(
                PromptTranslator.translatePromptFields(translationSource, { mode: 'coverage' }),
                45000,
                `Prompt ${prompt?.id || ''} 补全双语超时，请稍后重试`
            );
            const { payload, nextCoverage } = buildPromptBilingualCoveragePatch(prompt, translatedFields);
            const currentOps = getPromptAdminOpsData(prompt);
            const currentAiTags = clonePromptAiTags(prompt.ai_tags || prompt.aiTags || {});

            if (currentOps.status === 'needs-localization' && nextCoverage.zh && nextCoverage.en) {
                const nextAiTags = buildPromptAiTagsPayload(currentAiTags, {
                    adminOps: {
                        ...currentOps,
                        status: ''
                    }
                });
                payload.ai_tags = nextAiTags || {};
            }

            if (Object.keys(payload).length === 0) {
                unchangedCount += 1;
                if (!nextCoverage.zh || !nextCoverage.en) {
                    incompleteCount += 1;
                }
                continue;
            }

            const response = await mutateAdminPrompt({
                action: 'patch',
                site: writableSite,
                id: prompt.id,
                payload
            });

            const bilingualPersistenceState = await verifyPromptPersistedBilingualFields(prompt.id, payload, response?.row || {});
            if (bilingualPersistenceState.missingFields.length > 0) {
                persistenceBlockedCount += 1;
                if (!persistenceWarningDetail) {
                    persistenceWarningDetail = buildPromptBilingualPersistenceWarningMessage(
                        bilingualPersistenceState.missingFields,
                        bilingualPersistenceState
                    );
                }
                console.warn('[Gallery] Batch bilingual completion did not persist bilingual fields:', prompt?.id, bilingualPersistenceState.missingFields, bilingualPersistenceState.verificationError);
                continue;
            }

            localizedRows.push({
                ...prompt,
                ...payload,
                ...(bilingualPersistenceState.row || response?.row || {}),
                id: prompt.id
            });
            localizedCount += 1;
            if (!nextCoverage.zh || !nextCoverage.en) {
                incompleteCount += 1;
            }
        } catch (error) {
            failedCount += 1;
            failureMessages.push(normalizeBatchPromptFailureMessage(error, prompt));
            console.error('[Gallery] Batch bilingual completion failed:', prompt?.id, error);
        } finally {
            processedCount += 1;
            if (progressToast && progressToast.isConnected && processedCount < selected.length) {
                setToastContent(progressToast, `正在补全双语 ${processedCount}/${selected.length}...`, 'info');
            }
        }
    }

    if (localizedCount > 0) {
        await loadAdminPrompts();
        hydrateAdminGalleryPromptsLocally(localizedRows);
    }

    if (persistenceBlockedCount > 0) {
        finalizeProgressToast(
            `有 ${persistenceBlockedCount} 条 Prompt 的双语结果暂未确认写入。${persistenceWarningDetail || '请刷新后复查。'}`,
            localizedCount > 0 ? 'warning' : 'error',
            6200
        );
        return false;
    }

    if (failedCount > 0) {
        const firstFailureMessage = failureMessages[0] ? `；${failureMessages[0]}` : '';
        finalizeProgressToast(`批量补全双语完成 ${localizedCount} 条，失败 ${failedCount} 条${firstFailureMessage}`, localizedCount > 0 ? 'warning' : 'error', 6200);
        return false;
    }

    if (localizedCount === 0 && unchangedCount > 0) {
        finalizeProgressToast(`已检查 ${unchangedCount} 条 Prompt，没有新增可补的双语字段`, incompleteCount > 0 ? 'warning' : 'success');
        return incompleteCount === 0;
    }

    if (incompleteCount > 0) {
        finalizeProgressToast(`已补全 ${localizedCount} 条 Prompt，仍有 ${incompleteCount} 条需要人工校对`, 'warning');
        return false;
    }

    finalizeProgressToast(`已批量补全 ${localizedCount} 条 Prompt 双语`, 'success');
    return true;
}

// ========================================
// COMMENT VIEW SWITCHING
// ========================================
function switchCommentView(viewName) {
    if (typeof window.switchAdminCommentsView === 'function') {
        return window.switchAdminCommentsView(viewName);
    }

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
        loadComments(viewName, { resetPage: true });
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
    setAdminStudioVisibility(bar, true);

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
    setAdminStudioVisibility(document.getElementById('batchEditBar'), false);
    cancelEdit();
}

// Modify the form save to support batch edit navigation
const originalFormSubmit = document.getElementById('promptForm')?.onsubmit;

// ========================================
// BATCH REANALYZE
// ========================================
async function startBatchReanalyze() {
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: '批量重分析 Prompt' });
    if (!writableSite) {
        return;
    }

    // Check API key first
    if (!window.AdminAI?.configured) {
        showToast(getCurrentAIMissingConfigMessage(), 'error');
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

    await executeBatchReanalyze(selected, { site: writableSite });
}

async function analyzeUntaggedPrompts() {
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: '分析无标签 Prompt' });
    if (!writableSite) {
        return;
    }

    // Find prompts without AI tags
    const untagged = allPrompts.filter(p => !p.ai_tags || Object.keys(p.ai_tags).length === 0);

    if (untagged.length === 0) {
        showToast('所有提示词都已有 AI 标签', 'success');
        return;
    }

    if (!confirm(`发现 ${untagged.length} 个无标签提示词。\n\n确定要分析吗？将消耗约 ${untagged.length} 次 API 请求。`)) {
        return;
    }

    await executeBatchReanalyze(untagged, { site: writableSite });
}

async function executeBatchReanalyze(prompts, options = {}) {
    const DELAY = 1500; // 1.5s between requests
    const writableSite = options.site || window.AdminSiteFilter?.getSiteFilter?.() || 'cn';
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
            await reanalyzeSinglePrompt(prompt, writableSite);
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

async function reanalyzeSinglePrompt(prompt, writableSite) {
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

    // Call current AI provider
    console.log(`🤖 Calling ${getCurrentAIServiceLabel()}...`);
    const result = await callAdminVision(base64);
    console.log(`✅ ${getCurrentAIServiceLabel()} response received:`, result);

    // Update in Supabase - correctly map the AI analysis fields
    // Note: callAdminVision returns objects, scenes, styles, mood directly, not under "tags"
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

    await mutateAdminPrompt({
        action: 'patch',
        site: writableSite,
        id: prompt.id,
        payload: updateData
    });

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
    showAdminStudioOverlay(document.getElementById('deleteConfirmOverlay'));
}

function hideDeleteConfirmation() {
    hideAdminStudioOverlay(document.getElementById('deleteConfirmOverlay'));
}

async function executeBatchDelete() {
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: '批量删除 Prompt' });
    if (!writableSite) {
        return;
    }

    hideDeleteConfirmation();

    const ids = Array.from(selectedPrompts);

    try {
        await deleteAdminPrompts({
            site: writableSite,
            ids
        });

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
    showAdminStudioOverlay(document.getElementById('batchProgressOverlay'));
    updateBatchProgress(0, total, '准备中...');
}

function hideBatchProgressModal() {
    hideAdminStudioOverlay(document.getElementById('batchProgressOverlay'));
}

function updateBatchProgress(current, total, currentItem) {
    const percent = Math.round((current / total) * 100);
    document.getElementById('batchCurrentItem').textContent = `正在分析: ${currentItem}`;
    document.getElementById('batchProgressFill').value = percent;
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
    showAdminStudioOverlay(document.getElementById('lightboxOverlay'));
}

function closeLightbox() {
    hideAdminStudioOverlay(document.getElementById('lightboxOverlay'));
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
    showAdminStudioOverlay(document.getElementById('cropModalOverlay'));

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
    hideAdminStudioOverlay(document.getElementById('cropModalOverlay'));
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

// AI semantic search
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
        if (p.title_zh) addToIndex(p.title_zh);
        if (p.title_en) addToIndex(p.title_en);
        if (p.description) addToIndex(p.description);
        if (p.description_zh) addToIndex(p.description_zh);
        if (p.description_en) addToIndex(p.description_en);
        if (p.prompt_text) addToIndex(p.prompt_text);
        if (p.prompt_text_zh) addToIndex(p.prompt_text_zh);
        if (p.prompt_text_en) addToIndex(p.prompt_text_en);
        if (p.id) addToIndex(String(p.id));

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
                p.id || '',
                p.title || '',
                p.title_zh || '',
                p.title_en || '',
                p.description || '',
                p.description_zh || '',
                p.description_en || '',
                p.prompt_text || '',
                p.prompt_text_zh || '',
                p.prompt_text_en || '',
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
 * AI semantic search using the currently configured admin AI provider
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
            model: window.AdminAI?.defaultModel || DEFAULT_ADMIN_VISION_MODEL,
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
    adminGalleryViewState.searchMatchedIds = matchedIds instanceof Set
        ? new Set(Array.from(matchedIds, (id) => String(id)))
        : null;
    applyAdminGalleryFilters({ resetPage: true });
}

/**
 * Main search function - 3 layer strategy
 * Layer 1 & 2: Local search with synonym expansion
 * Layer 3: AI semantic search (if local fails)
 */
async function filterBySearch(query) {
    const queryLower = String(query || '').trim().toLowerCase();
    adminGalleryViewState.searchQuery = queryLower;

    // If no query, show all cards
    if (!queryLower) {
        adminGalleryViewState.searchMatchedIds = null;
        applyAdminGalleryFilters({ resetPage: true });
        return;
    }

    // Check if query is a color search
    let searchingForColor = null;
    if (COLOR_MAP[queryLower]) {
        searchingForColor = COLOR_MAP[queryLower];
    }

    // === 3-LAYER SEARCH STRATEGY ===
    // Layer 1 & 2: Local search (instant, no network)
    const localResults = performLocalSearch(queryLower, searchingForColor);
    console.log(`🔍 Local search: found ${localResults.size} results for "${queryLower}"`);

    // If local search found results, use them directly
    if (localResults.size > 0) {
        applySearchResults(localResults);
        return;
    }

    // Layer 3: AI Semantic Search (only if local search failed)
    console.log('🔍 Local search: 0 results, triggering AI semantic search...');
    const aiResults = await performAISemanticSearch(queryLower);
    if (adminGalleryViewState.searchQuery !== queryLower) {
        return;
    }

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

    if (searchInput.dataset.gallerySearchBound === '1') {
        return;
    }

    searchInput.dataset.gallerySearchBound = '1';

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
            setAdminStudioVisibility(suggestionsSection, false, 'is-visible');
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
            if (p.title_zh?.toLowerCase().includes(lowerQuery)) {
                suggestions.add(p.title_zh);
            }
            if (p.title_en?.toLowerCase().includes(lowerQuery)) {
                suggestions.add(p.title_en);
            }
            if (Array.isArray(p.tags)) {
                p.tags.forEach(tag => {
                    if (tag.toLowerCase().includes(lowerQuery)) suggestions.add(tag);
                });
            }
        });

        const suggestionArray = Array.from(suggestions).slice(0, 5);

        if (suggestionArray.length === 0) {
            setAdminStudioVisibility(suggestionsSection, false, 'is-visible');
            hideDropdown();
            return;
        }

        showDropdown();
        setAdminStudioVisibility(suggestionsSection, true, 'is-visible');

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
                void filterBySearch(item.textContent.toLowerCase());
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
            void filterBySearch(query.toLowerCase());
        }, 200);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            void filterBySearch('');
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
    const languageFilterInput = document.getElementById('languageFilter');
    const statusFilterInput = document.getElementById('statusFilter');
    const sortFilterInput = document.getElementById('sortFilter');

    function applyAllFilters() {
        applyAdminGalleryFilters({ resetPage: true });
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

    if (languageFilterInput) {
        languageFilterInput.addEventListener('change', () => {
            console.log('🌐 Language filter changed:', languageFilterInput.value);
            applyAllFilters();
        });
    }

    if (statusFilterInput) {
        statusFilterInput.addEventListener('change', () => {
            console.log('🧭 Status filter changed:', statusFilterInput.value);
            applyAllFilters();
        });
    }

    if (sortFilterInput) {
        sortFilterInput.addEventListener('change', () => {
            console.log('↕️ Sort filter changed:', sortFilterInput.value);
            adminGalleryViewState.sortValue = normalizeAdminGallerySortValue(sortFilterInput.value);
            applyAllFilters();
        });
    }

    console.log('✅ Admin search setup complete');
}
