/* ========================================
   ADMIN STUDIO - JavaScript
   AI-Powered Prompt Upload System
   ======================================== */

// ========================================
// CONFIGURATION
// ========================================
const DEFAULT_ADMIN_VISION_MODEL = 'gemini-2.5-flash';
const ADMIN_AI_IMAGE_DEFAULT_MODEL = 'gpt-image-2';
const ADMIN_VISION_ANALYSIS_TIMEOUT_MS = 45000;
const ADMIN_VISION_ANALYSIS_MAX_OUTPUT_TOKENS = 2048;
const PROMPT_UPLOAD_ORIGINAL_MAX_WIDTH = 2048;
const PROMPT_UPLOAD_ORIGINAL_QUALITY = 0.9;
const ADMIN_VISION_SINGLE_IMAGE_MAX_WIDTH = 1024;
const ADMIN_VISION_SINGLE_IMAGE_QUALITY = 0.8;
const ADMIN_VISION_GRID_CELL_SIZE = 448;
const ADMIN_VISION_RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const PROMPT_UPLOAD_IMAGE_VARIANTS = Object.freeze([
    { id: 'thumb', maxWidth: 800, quality: 0.85 },
    { id: 'featured', maxWidth: 1280, quality: 0.8 },
    { id: 'card', maxWidth: 560, quality: 0.76 },
    { id: 'home', maxWidth: 420, quality: 0.74 }
]);
const PROMPT_UPLOAD_SAFE_VARIANT_IDS = new Set(['thumb', 'featured', 'card', 'home']);
const ADMIN_STUDIO_ACCESS_RESTORE_TIMEOUT_MS = 7000;
const ADMIN_STUDIO_ACCESS_GATE_TIMEOUT_MS = 10000;
const ADMIN_STUDIO_SESSION_WARM_TIMEOUT_MS = 1800;
const ADMIN_GALLERY_HOMEPAGE_WARM_TIMEOUT_MS = 5000;
let allPrompts = []; // Cache all prompts for local search
const ADMIN_GALLERY_PAGE_SIZE = 10;
const ADMIN_GALLERY_EAGER_IMAGE_COUNT = 4;
const PROMPT_IMAGE_ASSET_KEYS = Object.freeze(['original', 'thumb', 'featured', 'card', 'home']);
const PROMPT_IMAGE_CDN_VARIANT_PATHS = new Set(['thumb', 'featured', 'card', 'home']);
const adminGalleryPrefetchState = {
    site: '',
    loaded: false,
    promise: null
};
const ADMIN_GALLERY_BILINGUAL_BATCH_SIZE = 12;
const adminGalleryLoadState = {
    site: '',
    queryKey: '',
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
    sortValue: 'updated-desc',
    filteredPromptIds: [],
    pagination: {
        page: 1,
        pageSize: ADMIN_GALLERY_PAGE_SIZE,
        totalItems: 0,
        totalPages: 1,
        hasPrevPage: false,
        hasNextPage: false,
        returnedItems: 0
    }
};

function getPendingAdminGalleryFocusPromptId() {
    return String(window.__pendingAdminGalleryFocusPromptId || '').trim();
}

function setPendingAdminGalleryFocusPromptId(promptId = '') {
    window.__pendingAdminGalleryFocusPromptId = String(promptId || '').trim();
    return window.__pendingAdminGalleryFocusPromptId;
}

// State
let uploadedFiles = [];
let analysisResult = null;
let currentEditingPromptImageUrls = [];
let currentEditingPromptImageAssets = [];
const pendingUploadFileFingerprints = new Set();
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
    '.comment-detail-drawer.is-open',
    '.admin-discount-detail-overlay.is-visible',
    '.admin-discount-restore-overlay.is-visible',
    '.admin-shop-risk-case-modal.is-visible',
    '.drawer-overlay.active',
    '.lightbox-overlay.active',
    '#ticketReplyModal.is-visible',
    '#ticketBulkProcessModal.is-visible',
    '.shop-refund-modal-overlay.is-visible',
    '.shop-order-content-overlay.is-visible',
    '.shop-inventory-detail-overlay.is-visible',
    '.shop-inventory-fault-overlay.is-visible'
].join(', ');

function dedupePromptImageUrls(urls = []) {
    const seen = new Set();
    const result = [];
    for (const value of (Array.isArray(urls) ? urls : [])) {
        const original = getPromptImageCanonicalOriginalUrl(value);
        const key = getPromptImageCanonicalDedupeKey(original || value);
        if (!original || !key || seen.has(key)) continue;
        seen.add(key);
        result.push(original);
    }
    return result;
}

function getPromptImageUrlsFromAssets(assets = []) {
    const urls = [];
    for (const asset of (Array.isArray(assets) ? assets : [])) {
        const normalized = normalizePromptImageAsset(asset);
        if (!normalized) continue;
        urls.push(
            normalized.original,
            normalized.featured,
            normalized.card,
            normalized.home,
            normalized.thumb
        );
    }
    return dedupePromptImageUrls(urls);
}
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

function setAdminGalleryLoadingChrome() {
    const skeleton = document.getElementById('adminManageChromeSkeleton');
    if (skeleton) {
        skeleton.remove();
    }
}

function getAdminGallerySkeletonCardProfile(index = 0) {
    const profiles = [
        {
            title: [72, 48],
            meta: [58, 38],
            status: 68,
            metrics: [[24, 70], [28, 66]]
        },
        {
            title: [66, 54],
            meta: [62, 42],
            status: 64,
            metrics: [[24, 74], [28, 64]]
        },
        {
            title: [74, 52],
            meta: [54, 40],
            status: 72,
            metrics: [[24, 68], [28, 72]]
        }
    ];

    return profiles[Math.abs(Number.parseInt(index, 10) || 0) % profiles.length];
}

function createAdminGallerySkeletonCard(index = 0) {
    const profile = getAdminGallerySkeletonCardProfile(index);
    const card = document.createElement('div');
    card.className = 'admin-card admin-card--skeleton';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = `
        <div class="admin-card-media">
            <div class="admin-card-media-skeleton"></div>
        </div>
        <div class="admin-card-content">
            <div class="admin-card-header">
                <div class="admin-card-title admin-card-title--skeleton admin-card-skeleton-copy">
                    <span class="admin-skeleton-block admin-skeleton-block--title" style="width:${profile.title[0]}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--title" style="width:${profile.title[1]}%"></span>
                </div>
                <span class="admin-card-status admin-card-status--skeleton" style="width:${profile.status}px"></span>
            </div>
            <div class="admin-card-meta-row admin-card-meta-row--skeleton">
                <div class="admin-card-language-summary">
                    <span class="admin-skeleton-block admin-skeleton-block--tiny" style="width:${profile.meta[0]}%"></span>
                </div>
                <div class="admin-card-updated-at">
                    <span class="admin-skeleton-block admin-skeleton-block--tiny" style="width:${profile.meta[1]}%"></span>
                </div>
            </div>
            <div class="admin-card-site-metrics">
                <div class="admin-card-site-metric admin-card-site-metric--skeleton">
                    <span class="admin-skeleton-block admin-skeleton-block--tiny" style="width:${profile.metrics[0][0]}px"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${profile.metrics[0][1]}%"></span>
                </div>
                <div class="admin-card-site-metric admin-card-site-metric--skeleton">
                    <span class="admin-skeleton-block admin-skeleton-block--tiny" style="width:${profile.metrics[1][0]}px"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${profile.metrics[1][1]}%"></span>
                </div>
            </div>
            <div class="admin-card-context-actions admin-card-context-actions--skeleton">
                <span class="admin-card-context-btn admin-card-context-btn--skeleton"></span>
                <span class="admin-card-context-btn admin-card-context-btn--skeleton"></span>
                <span class="admin-card-context-btn admin-card-context-btn--primary admin-card-context-btn--skeleton admin-card-context-btn--skeleton-primary"></span>
            </div>
        </div>
    `;
    return card;
}

function renderAdminGalleryLoadingState(options = {}) {
    const grid = document.getElementById('adminGrid');
    const pagination = document.getElementById('adminGalleryPagination');
    if (!grid) {
        return false;
    }

    const preserveExisting = options?.preserveExisting === true;
    if (preserveExisting && getAdminGalleryCards().length > 0) {
        return false;
    }

    const skeletonCount = Math.min(
        Math.max(Number.parseInt(options?.count, 10) || ADMIN_GALLERY_PAGE_SIZE, 4),
        ADMIN_GALLERY_PAGE_SIZE
    );
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < skeletonCount; index += 1) {
        fragment.appendChild(createAdminGallerySkeletonCard(index));
    }
    grid.replaceChildren(fragment);
    if (pagination) {
        pagination.innerHTML = '';
    }
    return true;
}

function syncAdminSearchCardVisibility(card, visible) {
    if (!card) return;
    card.classList.toggle('admin-card--hidden-by-search', !visible);
}

function sanitizeImageUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';

    const trimmed = url.trim();
    if (trimmed.startsWith('data:image/')) return trimmed;
    if (isSupabaseStorageImageUrl(trimmed)) return '';

    try {
        const parsed = new URL(trimmed, window.location.origin);
        if (['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
            return window.SiteConfig?.normalizeAssetUrlForCurrentSite?.(parsed.href) || parsed.href;
        }
    } catch (err) {
        console.warn('Blocked unsafe image URL:', trimmed, err);
    }

    return '';
}

function getPromptImageCdnVariantInfo(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) {
        return { original: '', variant: '' };
    }

    try {
        const parsed = new URL(trimmed, window.location.origin);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isPromptCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)
            || parsed.hostname.endsWith('.r2.dev');

        if (
            isPromptCdnHost
            && parts.length === 3
            && parts[0] === 'prompts'
            && PROMPT_IMAGE_CDN_VARIANT_PATHS.has(parts[1])
        ) {
            parsed.pathname = `/prompts/${parts[2]}`;
            parsed.search = '';
            parsed.hash = '';
            return {
                original: parsed.toString(),
                variant: parts[1]
            };
        }
    } catch (err) {
        return { original: trimmed, variant: '' };
    }

    return { original: trimmed, variant: '' };
}

function getPromptImageCanonicalOriginalUrl(url) {
    return getPromptImageCdnVariantInfo(url).original;
}

function getPromptImageCanonicalDedupeKey(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    try {
        const parsed = new URL(trimmed, window.location.origin);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isPromptCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)
            || parsed.hostname.endsWith('.r2.dev');
        if (isPromptCdnHost && parts[0] === 'prompts') {
            const filename = parts.length === 3 && PROMPT_IMAGE_CDN_VARIANT_PATHS.has(parts[1])
                ? parts[2]
                : (parts.length === 2 ? parts[1] : '');
            if (filename) {
                return `prompts/${decodeURIComponent(filename)}`;
            }
        }
    } catch (err) {
        return trimmed;
    }

    return getPromptImageCanonicalOriginalUrl(trimmed) || trimmed;
}

function assignPromptImageAssetUrl(asset, key, url) {
    const safeUrl = sanitizeImageUrl(url);
    if (!safeUrl) return;

    const variantInfo = getPromptImageCdnVariantInfo(safeUrl);
    const normalizedKey = PROMPT_IMAGE_ASSET_KEYS.includes(key) ? key : 'original';
    const impliedVariant = variantInfo.variant || '';

    if (normalizedKey === 'original' && impliedVariant) {
        asset[impliedVariant] = asset[impliedVariant] || safeUrl;
    } else {
        asset[normalizedKey] = safeUrl;
    }

    if (!asset.original && variantInfo.original) {
        asset.original = variantInfo.original;
    }
}

function isSupabaseStorageImageUrl(url) {
    return /^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i.test(String(url || '').trim());
}

function normalizePromptImageAsset(value) {
    if (typeof value === 'string') {
        const asset = {};
        assignPromptImageAssetUrl(asset, 'original', value);
        return asset.original ? asset : null;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
        ? value.variants
        : {};
    const asset = {};

    for (const key of PROMPT_IMAGE_ASSET_KEYS) {
        assignPromptImageAssetUrl(asset, key, value[key] || variants[key]);
    }

    const fallbackOriginal = value.url || value.src || value.image;
    if (!asset.original && fallbackOriginal) {
        assignPromptImageAssetUrl(asset, 'original', fallbackOriginal);
    }

    return asset.original || asset.thumb || asset.featured || asset.card || asset.home ? asset : null;
}

function normalizePromptImageAssetsFromRecord(prompt = {}) {
    const explicitAssets = Array.isArray(prompt?.image_assets)
        ? prompt.image_assets
        : (Array.isArray(prompt?.imageAssets) ? prompt.imageAssets : []);
    const legacyImages = Array.isArray(prompt?.images) ? prompt.images : [];

    const assets = dedupePromptImageAssets(explicitAssets);
    const assetsByKey = new Map(
        assets
            .map((asset) => [
                getPromptImageCanonicalDedupeKey(asset.original || asset.featured || asset.card || asset.home || asset.thumb || ''),
                asset
            ])
            .filter(([key]) => Boolean(key))
    );

    for (const imageUrl of legacyImages) {
        const asset = normalizePromptImageAsset(imageUrl);
        if (!asset?.original) continue;
        const key = getPromptImageCanonicalDedupeKey(asset.original);
        if (assetsByKey.has(key)) {
            const existing = assetsByKey.get(key);
            existing.original = asset.original || existing.original;
            for (const assetKey of PROMPT_IMAGE_ASSET_KEYS) {
                if (!existing[assetKey] && asset[assetKey]) {
                    existing[assetKey] = asset[assetKey];
                }
            }
            continue;
        }
        assets.push(asset);
        assetsByKey.set(key, asset);
    }

    return assets;
}

function dedupePromptImageAssets(assets = []) {
    const seen = new Map();
    return (Array.isArray(assets) ? assets : [])
        .map(normalizePromptImageAsset)
        .filter((asset) => {
            if (!asset) return false;
            const key = getPromptImageCanonicalDedupeKey(asset.original || asset.featured || asset.card || asset.home || asset.thumb || '');
            if (!key) return false;
            if (seen.has(key)) {
                const existing = seen.get(key);
                for (const assetKey of PROMPT_IMAGE_ASSET_KEYS) {
                    if (!existing[assetKey] && asset[assetKey]) {
                        existing[assetKey] = asset[assetKey];
                    }
                }
                return false;
            }
            seen.set(key, asset);
            return true;
        });
}

function getPromptImageAssetUrl(assetOrUrl, variant = 'original') {
    const asset = normalizePromptImageAsset(assetOrUrl);
    if (!asset) return '';

    const key = String(variant || 'original').trim() || 'original';
    return asset[key] || asset.original || asset.featured || asset.card || asset.home || asset.thumb || '';
}

function getPromptImageAssetOriginalUrl(assetOrUrl) {
    return getPromptImageAssetUrl(assetOrUrl, 'original');
}

function getOptimizedPromptCardImageUrl(url) {
    const imageAsset = typeof url === 'string' ? null : normalizePromptImageAsset(url);
    const explicitCardUrl = String(imageAsset?.card || '').trim();
    if (explicitCardUrl) return explicitCardUrl;

    const rawUrl = typeof url === 'string' ? url : getPromptImageAssetOriginalUrl(url);
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
    const trimmed = rawUrl.trim();

    if (
        (
            trimmed.includes('cdn.fatherkey.com/prompts/')
            || trimmed.includes('cdn.zaoyoe.com/prompts/')
        )
        && !trimmed.includes('/thumb/')
    ) {
        return trimmed.replace('/prompts/', '/prompts/thumb/');
    }

    if (isSupabaseStorageImageUrl(trimmed)) {
        return '';
    }

    return trimmed;
}

function sanitizePromptImageUrl(url) {
    const safeUrl = sanitizeImageUrl(url);
    if (!safeUrl) return '';
    return getOptimizedPromptCardImageUrl(safeUrl);
}

function buildAdminPromptCardImageCandidates(url, primarySrc = '') {
    const originalSrc = getPromptImageAssetOriginalUrl(url);
    if (!originalSrc) {
        return {
            originalSrc: '',
            primarySrc: '',
            transformFallbackSrc: ''
        };
    }

    const resolvedPrimarySrc = primarySrc || getOptimizedPromptCardImageUrl(originalSrc);
    const transformFallbackSrc = getOptimizedPromptCardImageUrl(originalSrc, { format: '' });

    return {
        originalSrc,
        primarySrc: resolvedPrimarySrc,
        transformFallbackSrc: transformFallbackSrc && transformFallbackSrc !== resolvedPrimarySrc
            ? transformFallbackSrc
            : ''
    };
}

function setAdminPromptCardImagePriority(image, { eager = false } = {}) {
    if (!(image instanceof HTMLImageElement)) return;

    image.loading = eager ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.setAttribute('fetchpriority', eager ? 'high' : 'auto');
    if ('fetchPriority' in image) {
        image.fetchPriority = eager ? 'high' : 'auto';
    }
}

function markAdminPromptCardImageReady(card, image) {
    if (card) {
        card.classList.add('admin-card--image-loaded');
    }
    if (image) {
        image.dataset.loadState = 'loaded';
    }
}

function handleAdminPromptCardImageLoad(event) {
    const image = event?.currentTarget;
    if (!(image instanceof HTMLImageElement)) return;
    markAdminPromptCardImageReady(image.closest('.admin-card'), image);
}

function handleAdminPromptCardImageError(event) {
    const image = event?.currentTarget;
    if (!(image instanceof HTMLImageElement)) return;

    const transformFallbackSrc = String(image.dataset.transformFallbackSrc || '').trim();
    const originalSrc = String(image.dataset.originalSrc || '').trim();

    if (
        !image.dataset.fallbackStage
        && transformFallbackSrc
        && !isSupabaseStorageImageUrl(transformFallbackSrc)
        && image.src !== transformFallbackSrc
    ) {
        image.dataset.fallbackStage = 'transform';
        image.src = transformFallbackSrc;
        return;
    }

    if (
        image.dataset.fallbackStage !== 'original'
        && originalSrc
        && !isSupabaseStorageImageUrl(originalSrc)
        && image.src !== originalSrc
    ) {
        image.dataset.fallbackStage = 'original';
        image.src = originalSrc;
        return;
    }

    image.dataset.loadState = 'failed';
    markAdminPromptCardImageReady(image.closest('.admin-card'), image);
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

const GALLERY_VIEW_NAMES = Object.freeze(new Set(['create', 'import', 'manage']));

function getAdminGalleryRouteState() {
    const url = getAdminGalleryRouteUrlObject();
    const searchParams = url?.searchParams;
    const routeView = String(searchParams?.get('gallery_view') || '').trim().toLowerCase();
    return {
        view: GALLERY_VIEW_NAMES.has(routeView) ? routeView : 'create',
        promptId: String(searchParams?.get('gallery_prompt_id') || '').trim()
    };
}

function syncAdminGalleryRouteState(nextState = {}, options = {}) {
    const url = getAdminGalleryRouteUrlObject();
    if (!url || typeof window.history?.replaceState !== 'function') {
        return false;
    }

    const currentState = getAdminGalleryRouteState();
    const requestedView = String(nextState.view || '').trim().toLowerCase();
    const view = Object.prototype.hasOwnProperty.call(nextState, 'view')
        ? (GALLERY_VIEW_NAMES.has(requestedView) ? requestedView : 'create')
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

const HOMEPAGE_PROMPT_POOL_LAST_UPDATED_KEY = 'homepage_prompt_pool_last_updated_at';

function markHomepagePromptPoolUpdated() {
    const timestamp = String(Date.now());
    ['cn', 'intl'].forEach((site) => {
        try {
            localStorage.setItem(`${HOMEPAGE_PROMPT_POOL_LAST_UPDATED_KEY}_${site}`, timestamp);
        } catch (error) {
            console.warn('[Gallery] Failed to invalidate homepage prompt pool cache for site:', site, error);
        }
    });
}

const PROMPT_BILINGUAL_FIELD_KEYS = Object.freeze([
    'title_zh',
    'title_en',
    'description_zh',
    'description_en',
    'prompt_text_zh',
    'prompt_text_en'
]);

const PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS = Object.freeze([
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url'
]);

const PROMPT_BILINGUAL_SQL_GUIDE = 'supabase/migrations/add_bilingual_prompts_fields.sql';
const PROMPT_SOURCE_ATTRIBUTION_SQL_GUIDE = 'supabase/migrations/20260619_add_prompt_source_attribution.sql';
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
    ...PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS,
    ...PROMPT_BILINGUAL_FIELD_KEYS
].join(', ');

function getPromptMissingPersistedFields(attemptedPayload = {}, savedRow = {}, fieldNames = []) {
    const safeAttemptedPayload = attemptedPayload && typeof attemptedPayload === 'object' ? attemptedPayload : {};
    const safeSavedRow = savedRow && typeof savedRow === 'object' ? savedRow : {};

    return (Array.isArray(fieldNames) ? fieldNames : []).filter((fieldName) => {
        const attemptedValue = String(safeAttemptedPayload[fieldName] || '').trim();
        if (!attemptedValue) {
            return false;
        }

        const persistedValue = String(safeSavedRow[fieldName] || '').trim();
        return persistedValue !== attemptedValue;
    });
}

function getPromptMissingPersistedBilingualFields(attemptedPayload = {}, savedRow = {}) {
    return getPromptMissingPersistedFields(attemptedPayload, savedRow, PROMPT_BILINGUAL_FIELD_KEYS);
}

function getPromptMissingPersistedSourceAttributionFields(attemptedPayload = {}, savedRow = {}) {
    return getPromptMissingPersistedFields(attemptedPayload, savedRow, PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS);
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

function isMissingPromptSourceAttributionSchemaCacheError(error = null) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) {
        return false;
    }

    if (message.includes('prompt 引用原作者字段') && message.includes('schema cache')) {
        return true;
    }

    const mentionsSourceField = PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS.some((fieldName) => (
        message.includes(`column ${fieldName}`)
        || message.includes(`prompts.${fieldName}`)
        || message.includes(`"${fieldName}"`)
        || message.includes(`'${fieldName}'`)
    ));

    if (!mentionsSourceField) {
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

function getPromptRowsMissingBilingualIds(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => row && typeof row === 'object' && String(row.id || '').trim() && !promptHasAnyBilingualCopy(row))
        .map((row) => String(row.id || '').trim());
}

async function fetchPromptBilingualVerificationRows(promptIds = []) {
    const options = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {};
    const normalizedIds = [...new Set(
        (Array.isArray(promptIds) ? promptIds : [promptIds])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    )];
    if (!normalizedIds.length) {
        return [];
    }

    const site = options?.site || getAdminPromptsReadSite();
    const requestedBatchSize = Number.parseInt(options?.batchSize, 10);
    const batchSize = Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
        ? requestedBatchSize
        : normalizedIds.length;
    const rows = [];

    for (let start = 0; start < normalizedIds.length; start += batchSize) {
        const batch = normalizedIds.slice(start, start + batchSize);
        const payloads = await Promise.all(
            batch.map((id) => fetchAdminPromptItem(id, {
                site,
                hydrateBilingual: false
            }))
        );

        rows.push(
            ...payloads
                .map((payload) => payload?.row)
                .filter((row) => row && typeof row === 'object')
        );
    }

    return rows;
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

function buildPromptSourceAttributionPersistencePayload(attemptedPayload = {}) {
    const safeAttemptedPayload = attemptedPayload && typeof attemptedPayload === 'object' ? attemptedPayload : {};
    return PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS.reduce((nextPayload, fieldName) => {
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

async function persistPromptSourceAttributionFieldsViaSupabase(promptId = '', attemptedPayload = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return null;
    }

    const persistencePayload = buildPromptSourceAttributionPersistencePayload(attemptedPayload);
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
    const candidateIds = getPromptRowsMissingBilingualIds(safeRows);

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

async function verifyPromptPersistedSourceAttributionFields(promptId = '', attemptedPayload = {}, savedRow = {}) {
    const initialMissingFields = getPromptMissingPersistedSourceAttributionFields(attemptedPayload, savedRow);
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
        const missingFieldsAfterVerification = getPromptMissingPersistedSourceAttributionFields(attemptedPayload, mergedRow);
        if (!missingFieldsAfterVerification.length) {
            return {
                row: mergedRow,
                missingFields: [],
                schemaMissing: false,
                verificationError: null
            };
        }

        savedRow = mergedRow;
        lastVerificationError = new Error(`Prompt source attribution fields still missing after verification: ${missingFieldsAfterVerification.join(', ')}`);
    } catch (error) {
        lastVerificationError = error;
        if (isMissingPromptSourceAttributionSchemaCacheError(error)) {
            return {
                row: savedRow,
                missingFields: initialMissingFields,
                schemaMissing: true,
                verificationError: error
            };
        }
    }

    try {
        const persistedRow = await persistPromptSourceAttributionFieldsViaSupabase(promptId, attemptedPayload);
        const mergedRow = persistedRow
            ? {
                ...(savedRow && typeof savedRow === 'object' ? savedRow : {}),
                ...persistedRow
            }
            : savedRow;
        return {
            row: mergedRow,
            missingFields: getPromptMissingPersistedSourceAttributionFields(attemptedPayload, mergedRow),
            schemaMissing: false,
            verificationError: null
        };
    } catch (error) {
        return {
            row: savedRow,
            missingFields: initialMissingFields,
            schemaMissing: isMissingPromptSourceAttributionSchemaCacheError(error),
            verificationError: error || lastVerificationError
        };
    }
}

function buildPromptSourceAttributionPersistenceWarningMessage(missingFields = []) {
    if (!Array.isArray(missingFields) || missingFields.length === 0) {
        return '';
    }

    const options = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {};
    if (options.schemaMissing) {
        return `当前 API / schema cache 还没识别到 Prompt 引用原作者字段；如果你已执行 ${PROMPT_SOURCE_ATTRIBUTION_SQL_GUIDE}，请再执行 select pg_notify('pgrst', 'reload schema');`;
    }

    if (options.verificationError) {
        return 'Prompt 已保存，但引用原作者字段暂未确认写入；请刷新后复查。';
    }

    return 'Prompt 已保存，但引用原作者字段仍未写回；请刷新后复查。';
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

async function fetchAdminPromptList({
    site = getAdminPromptsReadSite(),
    hydrateBilingual = true,
    page = adminGalleryViewState.page,
    pageSize = adminGalleryViewState.pageSize,
    search = adminGalleryViewState.searchQuery,
    category = '',
    date = '',
    language = '',
    status = '',
    sort = adminGalleryViewState.sortValue
} = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminPromptsUrl({
        site,
        page,
        pageSize,
        search,
        category,
        date,
        language,
        status,
        sort: normalizeAdminGallerySortValue(sort)
    }), {
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
    const url = new URL('/api/admin/prompts/manage', window.location.origin);
    if (site) {
        url.searchParams.set('site', String(site));
    }

    const normalizedSingleId = String(id || '').trim();
    const normalizedIds = Array.isArray(ids)
        ? ids.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    if (normalizedSingleId) {
        url.searchParams.set('id', normalizedSingleId);
    }
    normalizedIds.forEach((value) => {
        url.searchParams.append('ids', value);
    });

    const response = await (window.AdminApi?.fetch || fetch)(`${url.pathname}${url.search}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            site,
            id: normalizedSingleId,
            ids: normalizedIds
        })
    });

    return parseAdminPromptsResponse(response);
}

// ========================================
// THEME INITIALIZATION - Sync with Gallery
// ========================================
function syncAdminStudioThemeToggle() {
    const toggleBtn = document.getElementById('adminThemeToggleBtn');
    if (!toggleBtn) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const nextLabel = isDark ? '切换到亮色主题' : '切换到暗色主题';
    toggleBtn.setAttribute('aria-label', nextLabel);
    toggleBtn.setAttribute('title', nextLabel);
    toggleBtn.dataset.theme = isDark ? 'dark' : 'light';
}

window.syncAdminStudioThemeToggle = syncAdminStudioThemeToggle;

function applyAdminStudioThemePreference(themePreference) {
    const nextTheme = themePreference === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    window.applySiteThemeChrome?.(nextTheme);
    syncAdminStudioThemeToggle();
    return nextTheme;
}

(function exposeAdminStudioThemeToggle() {
    function persistAdminStudioThemePreference(themePreference) {
        const nextTheme = applyAdminStudioThemePreference(themePreference);
        try {
            localStorage.setItem('theme', nextTheme);
        } catch (error) {
            console.warn('[AdminStudio] Failed to persist theme preference:', error);
        }
        return nextTheme;
    }

    window.toggleAdminStudioTheme = function toggleAdminStudioTheme(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        persistAdminStudioThemePreference(nextTheme);
    };
}());

(function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
        applyAdminStudioThemePreference(savedTheme);
        return;
    }

    applyAdminStudioThemePreference('light');
})();

// Listen for theme changes from other tabs (Gallery)
window.addEventListener('storage', (e) => {
    if (e.key === 'theme') {
        applyAdminStudioThemePreference(e.newValue);
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
    window.AdminStudioTiming?.mark?.('studio:access-granted', {
        isSuperAdmin: window.isSuperAdmin,
        permissionsCount: window.currentUserPermissions.length
    });

    console.log('🛡️ Permissions loaded:', {
        isSuperAdmin: window.isSuperAdmin,
        permissions: window.currentUserPermissions
    });

    window.dispatchEvent(new CustomEvent('adminStudioAccessGranted'));
    window.dispatchEvent(new CustomEvent('permissionsLoaded'));
    updateUIBasedOnPermissions();
}

async function requireAdminStudioAccess() {
    window.adminStudioAccessGranted = false;
    renderAdminStudioAccessGate('pending');

    const resolveGateTimeoutMs = () => {
        const override = Number(window.__adminStudioAccessGateTimeoutMs);
        if (Number.isFinite(override) && override > 0) {
            return override;
        }
        return ADMIN_STUDIO_ACCESS_GATE_TIMEOUT_MS;
    };

    const resolveSessionWarmTimeoutMs = () => {
        const override = Number(window.__adminStudioSessionWarmTimeoutMs);
        if (Number.isFinite(override) && override > 0) {
            return override;
        }
        return typeof ADMIN_STUDIO_SESSION_WARM_TIMEOUT_MS === 'number'
            ? ADMIN_STUDIO_SESSION_WARM_TIMEOUT_MS
            : 1800;
    };

    const waitWithTimeout = async (promise, timeoutMs, fallback = null) => {
        let timeoutId = 0;
        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise((resolve) => {
                    timeoutId = window.setTimeout(() => resolve(fallback), Math.max(250, Number(timeoutMs) || 1000));
                })
            ]);
        } finally {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        }
    };

    let sessionRestoreState = {
        restored: false,
        reason: 'not_started'
    };

    try {
        sessionRestoreState = await waitWithTimeout(
            window.__adminStudioSessionRestoreReady,
            ADMIN_STUDIO_ACCESS_RESTORE_TIMEOUT_MS,
            {
                restored: false,
                reason: 'restore_timeout'
            }
        );
    } catch (error) {
        console.warn('[AdminStudio] Supabase session restore wait failed:', error);
        sessionRestoreState = {
            restored: false,
            reason: 'restore_exception',
            error
        };
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

    const buildTimedOutAccessResult = () => ({
        user: null,
        isAdmin: false,
        isSuperAdmin: false,
        permissions: [],
        timedOut: true,
        error: new Error('Admin Studio access check timed out')
    });

    const lookupAdminAccess = async (forceRefresh = false) => {
        try {
            const result = await waitWithTimeout(
                accessClient.getCurrentAdminAccess({
                    forceRefresh: forceRefresh === true
                }),
                resolveGateTimeoutMs(),
                buildTimedOutAccessResult()
            );

            if (result) {
                return result;
            }

            return {
                user: null,
                isAdmin: false,
                isSuperAdmin: false,
                permissions: [],
                lookupFailed: true,
                error: new Error('Admin Studio access returned an empty result')
            };
        } catch (error) {
            console.warn('[AdminStudio] Admin access lookup failed:', error);
            return {
                user: null,
                isAdmin: false,
                isSuperAdmin: false,
                permissions: [],
                lookupFailed: true,
                error
            };
        }
    };

    let access = await lookupAdminAccess(false);
    const shouldRetryAccessLookup = !access?.timedOut && (
        access?.lookupFailed === true
        || (access?.error && access?.user)
        || (access?.cached === true && !access?.isAdmin)
        || (!access?.user && sessionRestoreState?.restored === true)
    );

    if (shouldRetryAccessLookup) {
        access = await lookupAdminAccess(true);
    }

    if (access?.timedOut) {
        renderAdminStudioAccessGate('denied', {
            title: '后台权限校验超时',
            message: '权限服务响应时间过长，页面已停止等待以避免一直卡在加载状态。请刷新重试；如果仍然出现，请先回到首页重新进入后台。',
            primaryLabel: '刷新重试',
            primaryHref: 'admin-studio.html',
            secondaryLabel: '返回首页',
            secondaryHref: 'index.html'
        });
        return null;
    }

    if (access?.lookupFailed || (access?.error && !access?.isAdmin)) {
        renderAdminStudioAccessGate('denied', {
            title: '后台权限校验失败',
            message: '登录态已识别，但管理员权限服务暂时没有返回有效结果。页面已停止等待，避免一直卡在加载状态。请刷新重试；如果仍然出现，请回到首页重新进入后台。',
            primaryLabel: '刷新重试',
            primaryHref: 'admin-studio.html',
            secondaryLabel: '返回首页',
            secondaryHref: 'index.html'
        });
        return null;
    }

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

    const issueAdminStudioCookieSession = async (forceRefresh = false) => {
        if (!accessClient?.createAdminStudioSession || !access?.user?.id) {
            return {
                ok: false,
                skipped: true,
                reason: 'session_issue_unavailable'
            };
        }

        try {
            const sessionResult = await waitWithTimeout(
                accessClient.createAdminStudioSession({
                    supabaseClient: window.supabaseClient,
                    userId: access.user.id,
                    forceRefresh: forceRefresh === true
                }),
                resolveSessionWarmTimeoutMs(),
                {
                    ok: false,
                    timedOut: true,
                    reason: 'session_issue_timeout'
                }
            );

            return sessionResult || {
                ok: false,
                reason: 'session_issue_empty'
            };
        } catch (sessionError) {
            return {
                ok: false,
                reason: 'session_issue_failed',
                error: sessionError
            };
        }
    };

    let sessionResult = await issueAdminStudioCookieSession(false);
    window.adminStudioSessionGranted = Boolean(sessionResult?.ok);

    applyResolvedAdminAccess(access);
    renderAdminStudioAccessGate('granted');
    window.AdminCommandCenter?.setSecurityStatus?.('管理员权限已确认');

    if (!sessionResult?.ok) {
        console.warn('[AdminStudio] Admin Studio cookie session was not ready before shell startup:', sessionResult);
    }

    Promise.resolve()
        .then(async () => {
            if (sessionResult?.ok) {
                return sessionResult;
            }

            const retryResult = await issueAdminStudioCookieSession(true);
            sessionResult = retryResult;
            return retryResult;
        })
        .then((retryResult) => {
            window.adminStudioSessionGranted = Boolean(retryResult?.ok);
            if (!retryResult?.ok) {
                console.warn('[AdminStudio] Failed to issue admin studio cookie session:', retryResult);
            }
        })
        .catch((sessionError) => {
            window.adminStudioSessionGranted = false;
            console.warn('[AdminStudio] Failed to issue admin studio cookie session:', sessionError);
        });

    return access;
}

async function initializeAdminStudioShell() {
    bindAdminStudioDelegatedControls();
    observeAdminScrollbarAutoHide();
    observeAdminStudioModalScrollLock();
    initUploadZone();
    initForm();
    initCustomDropdown();
    renderCodexConfigPanel();
    const startupTasks = [
        warmAdminAIServicePreference(),
        refreshCodexConfig()
    ];
    initStarrySky(); // New: Starry background
    initBatchOperations();

    // Initialize admin site filter selector
    if (window.AdminSiteFilter) window.AdminSiteFilter.renderSiteSelector();
    if (typeof window.syncAdminStudioThemeToggle === 'function') {
        window.syncAdminStudioThemeToggle();
    }

    const galleryRouteState = getAdminGalleryRouteState();
    if (galleryRouteState.view !== 'create') {
        switchView(galleryRouteState.view);
    }

    await Promise.allSettled(startupTasks);
    await checkApiKey();
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

    function readOpsAlertWorkspaceContextFromActionElement(actionEl) {
        if (typeof window.readOpsAlertWorkspaceContextDataset === 'function') {
            return window.readOpsAlertWorkspaceContextDataset(actionEl?.dataset || {});
        }

        const dataset = actionEl?.dataset || {};
        return {
            title: dataset.workspaceTitle,
            alertType: dataset.workspaceAlertType,
            category: dataset.workspaceCategory,
            referenceLabel: dataset.workspaceReferenceLabel,
            referenceValue: dataset.workspaceReferenceValue,
            targetId: dataset.workspaceTargetId,
            userId: dataset.workspaceUserId,
            clientIp: dataset.workspaceClientIp,
            discountCode: dataset.workspaceDiscountCode,
            signalType: dataset.workspaceSignalType,
            caseStatus: dataset.workspaceCaseStatus,
            caseOwnerAdminId: dataset.workspaceCaseOwnerAdminId,
            caseOwnerLabel: dataset.workspaceCaseOwnerLabel
        };
    }

    function setAdminStudioDelegatedActionBusy(actionEl, busy = false) {
        if (!actionEl?.classList) {
            return;
        }

        actionEl.classList.toggle('is-running', busy);
        actionEl.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (busy) {
            actionEl.dataset.adminActionRunning = 'true';
            return;
        }
        delete actionEl.dataset.adminActionRunning;
    }

    function waitForAdminStudioActionModal(modalId = '', options = {}) {
        const normalizedModalId = String(modalId || '').trim();
        if (!normalizedModalId) {
            return Promise.resolve(true);
        }

        const timeoutMs = Math.max(120, Number(options.timeoutMs || 480));
        const stepMs = Math.max(24, Number(options.stepMs || 40));
        const failureMessage = String(options.failureMessage || '').trim();

        return new Promise((resolve) => {
            const startedAt = Date.now();

            const inspect = () => {
                const modal = document.getElementById(normalizedModalId);
                if (modal?.classList?.contains('is-visible')) {
                    resolve(true);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    if (modal) {
                        modal.classList.add('is-visible');
                        modal.setAttribute('aria-hidden', 'false');
                    }

                    const isVisible = modal?.classList?.contains('is-visible') === true;
                    if (!isVisible && failureMessage) {
                        window.showToast?.(failureMessage, 'error');
                    }
                    resolve(isVisible);
                    return;
                }

                window.setTimeout(inspect, stepMs);
            };

            inspect();
        });
    }

    function runAdminStudioDelegatedAction(actionEl, runner, options = {}) {
        if (!actionEl || typeof runner !== 'function') {
            return false;
        }

        if (actionEl.dataset.adminActionRunning === 'true') {
            pulseAdminStudioDelegatedAction(actionEl);
            return true;
        }

        const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
        const expectModalId = String(normalizedOptions.expectModalId || '').trim();
        const modalFailureMessage = String(normalizedOptions.modalFailureMessage || '').trim();
        const cleanupDelayMs = Math.max(120, Number(normalizedOptions.cleanupDelayMs || 220));

        setAdminStudioDelegatedActionBusy(actionEl, true);
        pulseAdminStudioDelegatedAction(actionEl);

        void Promise.resolve()
            .then(() => runner())
            .then(async (result) => {
                if (result === false) {
                    console.warn('[AdminStudio] Delegated action returned false:', {
                        action: actionEl?.dataset?.adminAction || '',
                        expectedModal: expectModalId
                    });
                    if (normalizedOptions.suppressFalseResultToast === true) {
                        return;
                    }
                    if (modalFailureMessage) {
                        window.showToast?.(modalFailureMessage, 'error');
                    } else if (normalizedOptions.errorMessage) {
                        window.showToast?.(normalizedOptions.errorMessage, 'error');
                    }
                    return;
                }

                if (expectModalId) {
                    await waitForAdminStudioActionModal(expectModalId, {
                        failureMessage: modalFailureMessage
                    });
                }
            })
            .catch((error) => {
                console.warn('[AdminStudio] Delegated action failed:', error);
                if (normalizedOptions.silentErrors !== true) {
                    window.showToast?.(
                        normalizedOptions.errorMessage || `操作失败: ${error?.message || '未知错误'}`,
                        'error'
                    );
                }
            })
            .finally(() => {
                window.setTimeout(() => {
                    setAdminStudioDelegatedActionBusy(actionEl, false);
                }, cleanupDelayMs);
            });

        return true;
    }

    function runAdminStudioActionFeedback(actionEl, runner, options = {}) {
        if (!actionEl || typeof runner !== 'function') {
            return false;
        }

        if (actionEl.dataset.adminActionRunning === 'true') {
            pulseAdminStudioDelegatedAction(actionEl);
            return true;
        }

        const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
        const feedback = window.AdminStudioActionFeedback;
        const canRenderButtonFeedback = actionEl.tagName === 'BUTTON'
            && normalizedOptions.skipButtonFeedback !== true
            && typeof feedback?.setLoading === 'function'
            && typeof feedback?.finish === 'function'
            && typeof feedback?.fail === 'function';
        const loadingText = String(normalizedOptions.loadingText || actionEl.dataset.adminActionFeedback || '处理中...').trim() || '处理中...';
        const successText = String(normalizedOptions.successText || '已完成').trim() || '已完成';
        const errorText = String(normalizedOptions.errorText || '失败').trim() || '失败';
        const restoreDelayMs = Number.isFinite(Number(normalizedOptions.restoreDelayMs))
            ? Number(normalizedOptions.restoreDelayMs)
            : undefined;

        setAdminStudioDelegatedActionBusy(actionEl, true);
        pulseAdminStudioDelegatedAction(actionEl);
        if (canRenderButtonFeedback) {
            feedback.setLoading(actionEl, {
                loadingText,
                compact: normalizedOptions.compact === true
            });
        }

        void Promise.resolve()
            .then(() => runner())
            .then((result) => {
                if ((result === null || typeof result === 'undefined') && normalizedOptions.restoreOnNull === true) {
                    if (canRenderButtonFeedback) {
                        feedback.restore(actionEl);
                    }
                    return result;
                }

                if (result === false) {
                    if (canRenderButtonFeedback) {
                        feedback.fail(actionEl, {
                            errorText,
                            restoreDelayMs,
                            compact: normalizedOptions.compact === true
                        });
                    }
                    return false;
                }

                if (canRenderButtonFeedback) {
                    if (normalizedOptions.restoreOnly === true) {
                        feedback.restore(actionEl);
                    } else {
                        feedback.finish(actionEl, {
                            successText,
                            restoreDelayMs,
                            hideIcon: normalizedOptions.hideSuccessIcon === true,
                            compact: normalizedOptions.compact === true
                        });
                    }
                }
                return result;
            })
            .catch((error) => {
                console.warn('[AdminStudio] Action feedback task failed:', error);
                if (canRenderButtonFeedback) {
                    feedback.fail(actionEl, {
                        errorText,
                        restoreDelayMs,
                        compact: normalizedOptions.compact === true
                    });
                }
                if (normalizedOptions.silentErrors !== true) {
                    window.showToast?.(
                        normalizedOptions.errorMessage || `操作失败: ${error?.message || '未知错误'}`,
                        'error'
                    );
                }
                return false;
            })
            .finally(() => {
                window.setTimeout(() => {
                    setAdminStudioDelegatedActionBusy(actionEl, false);
                }, Math.max(120, Number(normalizedOptions.cleanupDelayMs || 220)));
            });

        return true;
    }

    function runAdminStudioOpsAlertSampleAction(actionEl, runner) {
        return runAdminStudioActionFeedback(actionEl, runner, {
            loadingText: '发送中...',
            successText: '已发送',
            errorText: '发送失败',
            silentErrors: true
        });
    }

    function queueAdminStudioDelegatedAction(actionEl, runner, options = {}) {
        if (!actionEl || typeof runner !== 'function') {
            return false;
        }

        const queuedAt = Date.now();
        actionEl.dataset.adminActionQueuedAt = String(queuedAt);
        window.clearTimeout(actionEl._adminStudioQueuedActionTimer);
        actionEl._adminStudioQueuedActionTimer = window.setTimeout(() => {
            actionEl._adminStudioQueuedActionTimer = null;
            runAdminStudioDelegatedAction(actionEl, runner, options);
        }, 0);
        return true;
    }

    function consumeQueuedAdminStudioAction(actionEl, thresholdMs = 900) {
        if (!actionEl?.dataset) {
            return false;
        }

        const queuedAt = Number(actionEl.dataset.adminActionQueuedAt || 0);
        delete actionEl.dataset.adminActionQueuedAt;
        if (!queuedAt) {
            return false;
        }

        return Date.now() - queuedAt < Math.max(120, Number(thresholdMs || 900));
    }

    async function runOpsAlertMonitorBatchCaseAction(action) {
        const canOpenBatchComposerDirectly = typeof window.openOpsAlertBatchCaseComposer === 'function';
        if (typeof window.handleOpsAlertMonitorBatchCaseAction === 'function') {
            return Promise.resolve(window.handleOpsAlertMonitorBatchCaseAction(action)).catch((error) => {
                console.warn('[AdminStudio] Ops alert monitor batch action failed:', error);
                window.showToast?.(`集中告警批处理失败: ${error?.message || '未知错误'}`, 'error');
                return false;
            });
        }
        if (canOpenBatchComposerDirectly) {
            return Promise.resolve().then(() => {
                return window.openOpsAlertBatchCaseComposer(action);
            }).catch((error) => {
                console.warn('[AdminStudio] Ops alert monitor batch composer fallback failed:', error);
                window.showToast?.(`集中告警批处理失败: ${error?.message || '未知错误'}`, 'error');
                return false;
            });
        }
        window.showToast?.('集中告警处理入口还在加载，请刷新面板后重试。', 'warning');
        return false;
    }

    async function runOpsAlertCaseAction(actionEl) {
        const caseAction = String(actionEl?.dataset?.opsAlertCaseAction || '').trim().toLowerCase();
        if (!caseAction) {
            return false;
        }

        const context = readOpsAlertWorkspaceContextFromActionElement(actionEl);
        const canOpenComposerDirectly = ['assign', 'add_note', 'resolve'].includes(caseAction)
            && typeof window.openOpsAlertCaseComposer === 'function';
        if (typeof window.handleOpsAlertCaseAction === 'function') {
            return Promise.resolve(window.handleOpsAlertCaseAction(caseAction, context)).catch((error) => {
                console.warn('[AdminStudio] Ops alert case action failed:', error);
                window.showToast?.(`集中告警动作失败: ${error?.message || '未知错误'}`, 'error');
                return false;
            });
        }
        if (canOpenComposerDirectly) {
            return Promise.resolve().then(() => {
                return window.openOpsAlertCaseComposer(caseAction, context);
            }).catch((error) => {
                console.warn('[AdminStudio] Ops alert case composer fallback failed:', error);
                window.showToast?.(`集中告警动作失败: ${error?.message || '未知错误'}`, 'error');
                return false;
            });
        }
        window.showToast?.('集中告警动作入口还在加载，请刷新面板后重试。', 'warning');
        return false;
    }

    async function openOpsAlertMonitorBatchMuteModal() {
        if (typeof window.openOpsAlertBatchMuteModal !== 'function') {
            window.showToast?.('集中告警静默入口还在加载，请刷新面板后重试。', 'warning');
            return false;
        }
        window.openOpsAlertBatchMuteModal();
        return true;
    }

    function handleOpsAlertCaseActionElement(actionEl, event) {
        const actionName = String(actionEl?.dataset?.adminAction || '').trim();
        if (actionName !== 'settings-handle-ops-alert-case-action') {
            return false;
        }

        const caseAction = String(actionEl?.dataset?.opsAlertCaseAction || '').trim().toLowerCase();
        if (!caseAction) {
            return false;
        }

        const expectModalId = ['assign', 'add_note', 'resolve'].includes(caseAction)
            ? 'shopRiskCaseComposerModal'
            : '';

        const actionRunner = () => runOpsAlertCaseAction(actionEl);
        const actionOptions = {
            expectModalId,
            modalFailureMessage: '集中告警处理弹窗没有成功打开，请刷新后台后重试。',
            errorMessage: '集中告警动作执行失败，请刷新后台后重试。',
            silentErrors: true,
            suppressFalseResultToast: true
        };

        if (event?.type === 'pointerdown') {
            return queueAdminStudioDelegatedAction(actionEl, actionRunner, actionOptions);
        }

        if (event?.type === 'click' && consumeQueuedAdminStudioAction(actionEl)) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            return true;
        }

        event?.preventDefault?.();
        event?.stopPropagation?.();
        return runAdminStudioDelegatedAction(actionEl, actionRunner, actionOptions);
    }

    function handleOpsAlertMonitorBatchActionElement(actionEl, event) {
        const actionName = String(actionEl?.dataset?.adminAction || '').trim();
        const batchActionMap = {
            'settings-batch-claim-ops-alert-monitor': 'assign',
            'settings-batch-note-ops-alert-monitor': 'add_note',
            'settings-batch-resolve-ops-alert-monitor': 'resolve'
        };
        const batchAction = batchActionMap[actionName] || '';
        const isBatchMuteAction = actionName === 'settings-batch-mute-ops-alert-monitor';
        if (!batchAction && !isBatchMuteAction) {
            return false;
        }

        const actionRunner = () => {
            if (isBatchMuteAction) {
                return openOpsAlertMonitorBatchMuteModal();
            }
            return runOpsAlertMonitorBatchCaseAction(batchAction);
        };
        const actionOptions = {
            expectModalId: isBatchMuteAction ? 'opsAlertBatchMuteModal' : 'shopRiskCaseComposerModal',
            modalFailureMessage: isBatchMuteAction
                ? '集中告警静默弹窗没有成功打开，请刷新后台后重试。'
                : '集中告警处理弹窗没有成功打开，请刷新后台后重试。',
            errorMessage: '集中告警批处理执行失败，请刷新后台后重试。',
            silentErrors: true,
            suppressFalseResultToast: true
        };

        if (event?.type === 'pointerdown') {
            return queueAdminStudioDelegatedAction(actionEl, actionRunner, actionOptions);
        }

        if (event?.type === 'click' && consumeQueuedAdminStudioAction(actionEl)) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            return true;
        }

        event?.preventDefault?.();
        event?.stopPropagation?.();
        return runAdminStudioDelegatedAction(actionEl, actionRunner, actionOptions);
    }

    const OPS_ALERT_DIRECT_ACTION_SELECTOR = [
        '.btn-add-config[data-admin-action="settings-batch-claim-ops-alert-monitor"]',
        '.btn-add-config[data-admin-action="settings-batch-note-ops-alert-monitor"]',
        '.btn-add-config[data-admin-action="settings-batch-resolve-ops-alert-monitor"]',
        '.btn-add-config[data-admin-action="settings-batch-mute-ops-alert-monitor"]',
        '.btn-add-config[data-admin-action="settings-handle-ops-alert-case-action"]'
    ].join(', ');

    function bindAdminStudioOpsAlertDirectActionButtons(root = document) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        scope.querySelectorAll(OPS_ALERT_DIRECT_ACTION_SELECTOR).forEach((actionEl) => {
            if (!(actionEl instanceof HTMLElement) || actionEl.dataset.adminOpsAlertDirectBound === '1') {
                return;
            }

            actionEl.dataset.adminOpsAlertDirectBound = '1';
            actionEl.addEventListener('pointerdown', () => {
                if (actionEl.dataset.adminActionRunning !== 'true') {
                    pulseAdminStudioDelegatedAction(actionEl);
                }
            });
            actionEl.addEventListener('click', (event) => {
                const handled = handleOpsAlertMonitorBatchActionElement(actionEl, event)
                    || handleOpsAlertCaseActionElement(actionEl, event);
                if (handled) {
                    event.stopImmediatePropagation?.();
                }
            });
        });

        return true;
    }

    function triggerAdminStudioOpsAlertAction(actionEl, nativeEvent = null) {
        const handled = handleOpsAlertMonitorBatchActionElement(actionEl, nativeEvent)
            || handleOpsAlertCaseActionElement(actionEl, nativeEvent);
        if (!handled) {
            pulseAdminStudioDelegatedAction(actionEl);
        }
        return false;
    }

    window.bindAdminStudioOpsAlertDirectActionButtons = bindAdminStudioOpsAlertDirectActionButtons;
    window.triggerAdminStudioOpsAlertAction = triggerAdminStudioOpsAlertAction;
    bindAdminStudioOpsAlertDirectActionButtons(document);

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

        window.clearTimeout(actionEl._adminStudioActionPulseTimer);
        actionEl.classList.remove('is-pressed', 'is-click-feedback');
        void actionEl.offsetWidth;
        actionEl.classList.add('is-pressed', 'is-click-feedback');
        actionEl._adminStudioActionPulseTimer = window.setTimeout(() => {
            actionEl.classList?.remove('is-pressed', 'is-click-feedback');
        }, 360);
    }

    document.addEventListener('pointerdown', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const actionEl = target?.closest?.('.btn-add-config[data-admin-action], .ops-alert-monitor-filter-btn[data-admin-action]');
        if (!actionEl) {
            return;
        }

        pulseAdminStudioDelegatedAction(actionEl);
    }, { capture: true });

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        const actionEl = target?.closest?.('[data-admin-action]');
        if (!actionEl) {
            return;
        }

        if (String(actionEl.dataset.adminAction || '').trim() === 'payments-open-shop-order') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            runAdminStudioShopOrderOpenAction(actionEl);
            return;
        }

        if (String(actionEl.dataset.adminAction || '').trim() === 'settings-submit-shop-risk-case-modal') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            window.submitShopRiskCaseComposer?.();
            return;
        }

        if (String(actionEl.dataset.adminAction || '').trim() === 'settings-submit-ops-alert-batch-mute-modal') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            window.submitOpsAlertBatchMuteModal?.();
            return;
        }

        if (handleOpsAlertMonitorBatchActionElement(actionEl, event)) {
            event.stopImmediatePropagation?.();
            return;
        }
        if (handleOpsAlertCaseActionElement(actionEl, event)) {
            event.stopImmediatePropagation?.();
        }
    }, { capture: true });

    function decodeAdminStudioDatasetValue(value = '') {
        const raw = String(value || '').trim();
        if (!raw) {
            return '';
        }
        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    async function tryOpenAdminStudioShellContext(moduleName = '', context = {}, options = {}) {
        const normalizedModuleName = String(moduleName || '').trim().toLowerCase();
        if (!normalizedModuleName || !window.AdminShell?.openContext) {
            return false;
        }

        try {
            const opened = await window.AdminShell.openContext(normalizedModuleName, context, {
                settleMs: 0,
                silentDenied: true,
                ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {})
            });
            return opened === true;
        } catch (error) {
            console.warn(`[AdminStudio] Failed to open ${normalizedModuleName} through AdminShell:`, error);
            return false;
        }
    }

    async function openAdminStudioPromptGalleryContext(promptId = '', options = {}) {
        const normalizedPromptId = String(promptId || '').trim();
        if (!normalizedPromptId) {
            return false;
        }

        const context = {
            source: getAdminStudioActiveModuleId(),
            entity: 'prompt',
            action: 'open-prompt-gallery',
            focus: {
                promptId: normalizedPromptId,
                prompt_id: normalizedPromptId
            },
            payload: {
                ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}),
                promptId: normalizedPromptId,
                prompt_id: normalizedPromptId
            }
        };

        if (await tryOpenAdminStudioShellContext('gallery', context)) {
            return true;
        }

        if (typeof window.openAdminGalleryShellContext === 'function') {
            try {
                return await window.openAdminGalleryShellContext(context);
            } catch (error) {
                console.warn('[AdminStudio] Failed to open gallery prompt context through shared helper:', error);
            }
        }

        return window.openAdminGalleryPromptContext?.(normalizedPromptId, { ensureModule: true }) === true;
    }

    async function openAdminStudioPromptCommentsContext(context = {}) {
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
        const promptId = String(normalizedContext.promptId || normalizedContext.prompt_id || '').trim();
        const promptTitle = String(normalizedContext.promptTitle || normalizedContext.prompt_title || '').trim();
        const focusCommentId = String(
            normalizedContext.focusCommentId
            || normalizedContext.commentId
            || normalizedContext.comment_id
            || ''
        ).trim();
        const queue = String(normalizedContext.queue || '').trim().toLowerCase() || 'pending';
        const view = String(
            normalizedContext.view
            || normalizedContext.commentView
            || normalizedContext.comment_view
            || (promptId ? 'gallery' : 'guestbook')
        ).trim().toLowerCase() === 'gallery'
            ? 'gallery'
            : 'guestbook';
        const search = String(normalizedContext.search || '').trim();
        const shellContext = {
            source: String(normalizedContext.source || getAdminStudioActiveModuleId()).trim().toLowerCase(),
            entity: 'comment',
            action: focusCommentId ? 'focus-comment' : (promptId ? 'open-prompt-comments' : 'open-comments'),
            focus: {
                promptId,
                prompt_id: promptId,
                commentId: focusCommentId,
                comment_id: focusCommentId
            },
            payload: {
                ...normalizedContext,
                view,
                queue,
                search,
                promptId,
                prompt_id: promptId,
                promptTitle,
                prompt_title: promptTitle,
                focusCommentId,
                commentId: focusCommentId,
                comment_id: focusCommentId
            }
        };

        if (await tryOpenAdminStudioShellContext('comments', shellContext)) {
            return true;
        }

        if (view === 'gallery' && promptId && !focusCommentId && !search && queue === 'pending') {
            return window.openAdminPromptCommentContext?.({
                promptId,
                promptTitle,
                ensureModule: true
            }) === true;
        }

        return window.openAdminUserCommentContext?.({
            ...normalizedContext,
            view,
            queue,
            search,
            promptId,
            promptTitle,
            focusCommentId,
            commentId: focusCommentId,
            ensureModule: true
        }) === true;
    }

    async function openAdminStudioPromptHomepageContext(promptId = '', options = {}) {
        const normalizedPromptId = String(promptId || '').trim();
        const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
        const requestedSection = String(
            normalizedOptions.section
            || normalizedOptions.homepageSection
            || normalizedOptions.homepage_section
            || (normalizedPromptId ? 'prompts' : '')
        ).trim().toLowerCase();
        const context = {
            source: getAdminStudioActiveModuleId(),
            entity: 'homepage',
            action: normalizedPromptId ? 'open-prompt-homepage' : 'open-homepage-section',
            focus: {
                promptId: normalizedPromptId,
                prompt_id: normalizedPromptId
            },
            payload: {
                ...normalizedOptions,
                section: requestedSection || (normalizedPromptId ? 'prompts' : ''),
                promptId: normalizedPromptId,
                prompt_id: normalizedPromptId
            }
        };

        if (await tryOpenAdminStudioShellContext('homepage', context)) {
            return true;
        }

        if (typeof window.openAdminHomepageShellContext === 'function') {
            try {
                return await window.openAdminHomepageShellContext(context);
            } catch (error) {
                console.warn('[AdminStudio] Failed to open homepage prompt context through shared helper:', error);
            }
        }

        if (normalizedPromptId) {
            return window.HomepageAdmin?.openPromptSectionContext?.(
                normalizedPromptId,
                { ensureModule: true }
            ) === true;
        }

        const switched = window.switchModule?.('homepage');
        if (switched === false) {
            return false;
        }
        if (requestedSection) {
            window.HomepageAdmin?.switchSection?.(requestedSection);
        }
        return true;
    }

    async function openAdminStudioPromptAnalyticsContext(promptId = '', options = {}) {
        const normalizedPromptId = String(promptId || '').trim();
        if (!normalizedPromptId) {
            return false;
        }

        const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
        const promptTitle = String(normalizedOptions.promptTitle || normalizedOptions.prompt_title || '').trim();
        const context = {
            source: getAdminStudioActiveModuleId(),
            entity: 'prompt',
            action: 'open-prompt-analytics',
            focus: {
                promptId: normalizedPromptId,
                prompt_id: normalizedPromptId
            },
            payload: {
                ...normalizedOptions,
                analyticsTab: 'content',
                tab: 'content',
                sectionId: normalizedOptions.sectionId || normalizedOptions.focusTargetId || 'contentCommerceDetailSection',
                focusTargetId: normalizedOptions.focusTargetId || normalizedOptions.sectionId || 'contentCommerceDetailSection',
                promptId: normalizedPromptId,
                prompt_id: normalizedPromptId,
                promptTitle,
                prompt_title: promptTitle
            }
        };

        if (await tryOpenAdminStudioShellContext('growth-center', context, {
            switchOptions: {
                analyticsTab: 'content',
                analyticsPromptId: normalizedPromptId
            }
        })) {
            return true;
        }

        if (typeof window.openAdminGrowthCenterShellContext === 'function') {
            try {
                return await window.openAdminGrowthCenterShellContext(context, {
                    switchOptions: {
                        analyticsTab: 'content',
                        analyticsPromptId: normalizedPromptId
                    }
                });
            } catch (error) {
                console.warn('[AdminStudio] Failed to open growth center prompt context through shared helper:', error);
            }
        }

        const switched = window.switchModule?.('growth-center', {
            analyticsTab: 'content',
            analyticsPromptId: normalizedPromptId
        });
        return switched !== false;
    }

    async function openAdminStudioShopOrderContext(orderId = '') {
        const normalizedOrderId = String(orderId || '').replace(/^SHOP_ORDER_/i, '').trim();
        const emitShopFocusFeedback = (message = '', state = 'saved') => {
            const normalizedMessage = String(message || '').trim();
            if (!normalizedMessage) {
                return null;
            }

            return dispatchAdminStudioFeedbackSignal({
                kind: 'module-result',
                module: 'shop',
                source: 'payments-shop-profit-risk',
                state,
                message: normalizedMessage
            });
        };

        if (!normalizedOrderId) {
            emitShopFocusFeedback('商城订单入口缺少订单 ID，请刷新审计卡片后重试。', 'failed');
            return false;
        }

        const context = {
            source: getAdminStudioActiveModuleId(),
            entity: 'shop-order',
            action: 'focus-order',
            focus: {
                orderId: normalizedOrderId,
                order_id: normalizedOrderId
            },
            payload: {
                workspace: 'orders',
                defaultTab: 'orders',
                tab: 'orders',
                openDetails: true,
                focusTargetId: 'shopOrdersTable',
                focus_target_id: 'shopOrdersTable'
            }
        };

        if (typeof window.openAdminShopShellContext === 'function') {
            try {
                const opened = await window.openAdminShopShellContext(context, {
                    settleMs: 0,
                    silentDenied: true
                });
                if (opened !== false) {
                    emitShopFocusFeedback(`商城订单 ${normalizedOrderId} 已打开`);
                    return true;
                }
            } catch (error) {
                console.warn('[AdminStudio] Failed to open shop order through shared helper:', error);
            }
        }

        if (await tryOpenAdminStudioShellContext('shop', context)) {
            emitShopFocusFeedback(`商城订单 ${normalizedOrderId} 已打开`);
            return true;
        }

        if (typeof window.ShopAdmin?.openOrderDetailContext === 'function') {
            await window.ShopAdmin.openOrderDetailContext(normalizedOrderId, {
                source: 'payments-shop-profit-risk',
                openDetails: true
            });
            emitShopFocusFeedback(`商城订单 ${normalizedOrderId} 已打开`);
            return true;
        }

        if (typeof window.ShopAdmin?.focusOrder === 'function') {
            await window.ShopAdmin.focusOrder(normalizedOrderId, {
                openDetails: true
            });
            emitShopFocusFeedback(`商城订单 ${normalizedOrderId} 已定位`);
            return true;
        }

        emitShopFocusFeedback('商城订单详情暂时无法打开，请稍后重试。', 'failed');
        return false;
    }

    function runAdminStudioShopOrderOpenAction(actionEl) {
        return runAdminStudioActionFeedback(actionEl, () => (
            openAdminStudioShopOrderContext(decodeAdminStudioDatasetValue(actionEl?.dataset?.shopOrderId || ''))
        ), {
            loadingText: '打开订单中...',
            successText: '订单已打开',
            errorText: '打开失败',
            errorMessage: '商城订单详情打开失败，请稍后重试。',
            restoreDelayMs: 900,
            cleanupDelayMs: 260
        });
    }

    async function openAdminStudioPaymentsFocusContext(action = '', value = '') {
        const normalizedAction = String(action || '').trim().toLowerCase();
        const normalizedValue = String(value || '').trim();
        const sourceModule = getAdminStudioActiveModuleId();
        let context = null;

        const emitPaymentsFocusFallbackFeedback = (message = '', state = 'saved') => {
            const normalizedMessage = String(message || '').trim();
            if (!normalizedMessage) {
                return null;
            }

            return dispatchAdminStudioFeedbackSignal({
                kind: 'module-result',
                module: 'payments',
                source: 'payments-focus',
                state,
                message: normalizedMessage
            });
        };

        const getPaymentsIssueSummaryFallbackMessage = (kind = '') => {
            const normalizedKind = String(kind || '').trim().toLowerCase();
            if (normalizedKind === 'refund') {
                return '支付分析已切换到退款异常主题';
            }
            if (normalizedKind === 'ops') {
                return '支付分析已切换到运维告警队列';
            }
            if (normalizedKind === 'dead_letter') {
                return '支付分析已切换到死信告警队列';
            }
            if (normalizedKind === 'retry') {
                return '支付分析已切换到重试告警队列';
            }
            if (normalizedKind === 'review') {
                return '支付分析已切换到人工复核队列';
            }
            if (normalizedKind === 'failed') {
                return '支付分析已切换到失败订单队列';
            }
            return '支付分析聚焦视图已打开';
        };

        if (
            ['focus-exception-topic', 'issue-summary-focus', 'priority-focus-order', 'priority-focus-topic'].includes(normalizedAction)
            && !normalizedValue
        ) {
            emitPaymentsFocusFallbackFeedback('支付聚焦入口缺少目标标识，请刷新当前卡片后重试。', 'failed');
            return false;
        }

        if (normalizedAction === 'focus-exception-topic' && normalizedValue) {
            context = {
                source: sourceModule,
                entity: 'payments-ops',
                action: 'focus-exception-topic',
                payload: {
                    workspace: 'ops',
                    defaultTab: 'ops',
                    tab: 'ops',
                    exceptionTopic: normalizedValue,
                    exception_topic: normalizedValue,
                    focusTargetId: 'paymentsExceptionTopics',
                    focus_target_id: 'paymentsExceptionTopics'
                }
            };
        } else if (normalizedAction === 'focus-ops-alert-queue') {
            context = {
                source: sourceModule,
                entity: 'payments-ops',
                action: 'focus-queue',
                payload: {
                    workspace: 'ops',
                    defaultTab: 'ops',
                    tab: 'ops',
                    issueSummary: 'ops',
                    issue_summary: 'ops',
                    focusTargetId: 'paymentsOpsAlertQueuePanel',
                    focus_target_id: 'paymentsOpsAlertQueuePanel'
                }
            };
        } else if (normalizedAction === 'issue-summary-focus' && normalizedValue) {
            context = {
                source: sourceModule,
                entity: 'payments-ops',
                action: 'focus-issue-summary',
                payload: {
                    workspace: 'ops',
                    defaultTab: 'ops',
                    tab: 'ops',
                    issueSummary: normalizedValue,
                    issue_summary: normalizedValue,
                    focusTargetId: ['refund'].includes(normalizedValue)
                        ? 'paymentsExceptionTopics'
                        : (['ops', 'dead_letter', 'retry'].includes(normalizedValue)
                            ? 'paymentsOpsAlertQueuePanel'
                            : 'paymentsOrdersTable'),
                    focus_target_id: ['refund'].includes(normalizedValue)
                        ? 'paymentsExceptionTopics'
                        : (['ops', 'dead_letter', 'retry'].includes(normalizedValue)
                            ? 'paymentsOpsAlertQueuePanel'
                            : 'paymentsOrdersTable')
                }
            };
        } else if (normalizedAction === 'priority-focus-order' && normalizedValue) {
            context = {
                source: sourceModule,
                entity: 'payment-order',
                action: 'focus-order',
                focus: {
                    paymentOrderId: normalizedValue,
                    payment_order_id: normalizedValue
                },
                payload: {
                    paymentOrderId: normalizedValue,
                    payment_order_id: normalizedValue,
                    priorityAction: 'order',
                    priority_action: 'order',
                    defaultTab: 'overview',
                    tab: 'overview'
                }
            };
        } else if (normalizedAction === 'priority-focus-topic' && normalizedValue) {
            context = {
                source: sourceModule,
                entity: 'payments-ops',
                action: 'focus-priority-topic',
                payload: {
                    workspace: 'ops',
                    defaultTab: 'ops',
                    tab: 'ops',
                    priorityAction: 'topic',
                    priority_action: 'topic',
                    exceptionTopic: normalizedValue,
                    exception_topic: normalizedValue,
                    focusTargetId: 'paymentsExceptionTopics',
                    focus_target_id: 'paymentsExceptionTopics'
                }
            };
        } else if (normalizedAction === 'priority-focus-ops') {
            context = {
                source: sourceModule,
                entity: 'payments-ops',
                action: 'focus-priority-ops',
                payload: {
                    workspace: 'ops',
                    defaultTab: 'ops',
                    tab: 'ops',
                    priorityAction: 'ops',
                    priority_action: 'ops',
                    focusTargetId: 'paymentsOpsAlertQueuePanel',
                    focus_target_id: 'paymentsOpsAlertQueuePanel'
                }
            };
        }

        if (context && await tryOpenAdminStudioShellContext('payments', context)) {
            return true;
        }

        if (normalizedAction === 'focus-exception-topic') {
            if (typeof window.AdminPayments?.focusExceptionTopic !== 'function') {
                emitPaymentsFocusFallbackFeedback('支付异常主题暂时无法打开，请稍后重试。', 'failed');
                return false;
            }
            await window.AdminPayments.focusExceptionTopic(normalizedValue);
            emitPaymentsFocusFallbackFeedback(`支付异常主题 ${normalizedValue} 已定位`);
            return true;
        }
        if (normalizedAction === 'focus-ops-alert-queue') {
            if (typeof window.AdminPayments?.focusOpsAlertQueue !== 'function') {
                emitPaymentsFocusFallbackFeedback('支付运维告警队列暂时无法打开，请稍后重试。', 'failed');
                return false;
            }
            await window.AdminPayments.focusOpsAlertQueue();
            emitPaymentsFocusFallbackFeedback('支付运维告警队列已打开');
            return true;
        }
        if (normalizedAction === 'issue-summary-focus') {
            if (typeof window.AdminPayments?.focusAnalyticsIssueSummary !== 'function') {
                emitPaymentsFocusFallbackFeedback('支付分析聚焦暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            await window.AdminPayments.focusAnalyticsIssueSummary(normalizedValue);
            emitPaymentsFocusFallbackFeedback(getPaymentsIssueSummaryFallbackMessage(normalizedValue));
            return true;
        }
        if (normalizedAction === 'priority-focus-order') {
            if (typeof window.AdminPayments?.focusAnalyticsPrioritySummary !== 'function') {
                emitPaymentsFocusFallbackFeedback('支付订单聚焦暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            const focusResult = await window.AdminPayments.focusAnalyticsPrioritySummary('order', normalizedValue);
            const normalizedResult = focusResult && typeof focusResult === 'object'
                ? focusResult
                : window.AdminPayments?.getLastFocusResult?.();
            emitPaymentsFocusFallbackFeedback(
                normalizedResult?.matched
                    ? `支付订单 ${normalizedValue} 已定位`
                    : `支付订单 ${normalizedValue} 已打开，最近订单列表未匹配`,
                normalizedResult?.matched ? 'saved' : 'partial'
            );
            return true;
        }
        if (normalizedAction === 'priority-focus-topic') {
            if (typeof window.AdminPayments?.focusAnalyticsPrioritySummary !== 'function') {
                emitPaymentsFocusFallbackFeedback('支付优先级主题暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            await window.AdminPayments.focusAnalyticsPrioritySummary('topic', normalizedValue);
            emitPaymentsFocusFallbackFeedback(`支付优先级已切换到异常主题 ${normalizedValue}`);
            return true;
        }
        if (normalizedAction === 'priority-focus-ops') {
            if (typeof window.AdminPayments?.focusAnalyticsPrioritySummary !== 'function') {
                emitPaymentsFocusFallbackFeedback('支付优先级运维队列暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            await window.AdminPayments.focusAnalyticsPrioritySummary('ops');
            emitPaymentsFocusFallbackFeedback('支付优先级已切换到运维告警队列');
            return true;
        }

        emitPaymentsFocusFallbackFeedback('支付聚焦入口暂未识别，请刷新后台后重试。', 'failed');
        return false;
    }

    async function openAdminStudioTicketsFocusContext(action = '', value = '') {
        const normalizedAction = String(action || '').trim().toLowerCase();
        const normalizedValue = String(value || '').trim();
        const sourceModule = getAdminStudioActiveModuleId();
        let context = null;

        const emitTicketsFocusFallbackFeedback = (message = '', state = 'saved') => {
            const normalizedMessage = String(message || '').trim();
            if (!normalizedMessage) {
                return null;
            }

            return dispatchAdminStudioFeedbackSignal({
                kind: 'module-result',
                module: 'tickets',
                source: 'tickets-focus',
                state,
                message: normalizedMessage
            });
        };

        const getTicketsIssueSummaryFallbackMessage = (kind = '') => {
            const normalizedKind = String(kind || '').trim().toLowerCase();
            if (normalizedKind === 'status') {
                return '工单队列已切换到当前状态视图';
            }
            if (normalizedKind === 'overdue') {
                return '超时工单队列已打开';
            }
            if (normalizedKind === 'priority') {
                return '工单队列已切换到高优先级视图';
            }
            if (normalizedKind === 'refund') {
                return '工单队列已聚焦退款问题';
            }
            if (normalizedKind === 'delivery') {
                return '工单队列已聚焦发货问题';
            }
            if (normalizedKind === 'payment') {
                return '工单队列已聚焦支付问题';
            }
            return '工单队列已更新筛选视图';
        };

        if (
            ['issue-summary-focus', 'priority-open', 'priority-resolve', 'priority-reject'].includes(normalizedAction)
            && !normalizedValue
        ) {
            emitTicketsFocusFallbackFeedback('工单聚焦入口缺少目标标识，请刷新当前卡片后重试。', 'failed');
            return false;
        }

        if (normalizedAction === 'issue-summary-focus' && normalizedValue) {
            context = {
                source: sourceModule,
                entity: 'tickets',
                action: 'focus-issue-summary',
                payload: {
                    workspace: 'queue',
                    mode: 'pending',
                    status: 'pending',
                    issueSummary: normalizedValue,
                    issue_summary: normalizedValue,
                    focusTargetId: 'ticketsQueueControls',
                    focus_target_id: 'ticketsQueueControls'
                }
            };
        } else if (['priority-open', 'priority-resolve', 'priority-reject'].includes(normalizedAction) && normalizedValue) {
            const priorityAction = normalizedAction.replace(/^priority-/, '');
            context = {
                source: sourceModule,
                entity: 'ticket',
                action: `focus-${priorityAction}`,
                focus: {
                    ticketId: normalizedValue,
                    ticket_id: normalizedValue
                },
                payload: {
                    workspace: 'queue',
                    mode: 'pending',
                    status: 'pending',
                    priorityAction,
                    priority_action: priorityAction,
                    replyAction: priorityAction === 'open' ? '' : priorityAction,
                    ticketId: normalizedValue,
                    ticket_id: normalizedValue,
                    focusTargetId: 'ticketsQueueControls',
                    focus_target_id: 'ticketsQueueControls'
                }
            };
        } else if (normalizedAction === 'open-overdue-queue') {
            context = {
                source: sourceModule,
                entity: 'tickets',
                action: 'open-overdue-queue',
                payload: {
                    workspace: 'queue',
                    mode: 'pending',
                    status: 'pending',
                    overdueOnly: true,
                    overdue_only: true,
                    focusTargetId: 'ticketsQueueControls',
                    focus_target_id: 'ticketsQueueControls'
                }
            };
        }

        if (context && await tryOpenAdminStudioShellContext('tickets', context)) {
            return true;
        }

        if (normalizedAction === 'issue-summary-focus') {
            if (typeof window.AdminTickets?.focusAnalyticsIssueSummary !== 'function') {
                emitTicketsFocusFallbackFeedback('工单分析聚焦暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            await window.AdminTickets.focusAnalyticsIssueSummary(normalizedValue);
            emitTicketsFocusFallbackFeedback(getTicketsIssueSummaryFallbackMessage(normalizedValue));
            return true;
        }
        if (normalizedAction === 'priority-open') {
            if (typeof window.AdminTickets?.focusAnalyticsPrioritySummary !== 'function') {
                emitTicketsFocusFallbackFeedback('工单定位暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            return window.AdminTickets.focusAnalyticsPrioritySummary('open', normalizedValue) !== false;
        }
        if (normalizedAction === 'priority-resolve') {
            if (typeof window.AdminTickets?.focusAnalyticsPrioritySummary !== 'function') {
                emitTicketsFocusFallbackFeedback('工单定位暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            return window.AdminTickets.focusAnalyticsPrioritySummary('resolve', normalizedValue) !== false;
        }
        if (normalizedAction === 'priority-reject') {
            if (typeof window.AdminTickets?.focusAnalyticsPrioritySummary !== 'function') {
                emitTicketsFocusFallbackFeedback('工单定位暂时不可用，请稍后重试。', 'failed');
                return false;
            }
            return window.AdminTickets.focusAnalyticsPrioritySummary('reject', normalizedValue) !== false;
        }
        if (normalizedAction === 'open-overdue-queue') {
            if (typeof window.AdminTickets?.openOverdueQueue !== 'function') {
                emitTicketsFocusFallbackFeedback('超时工单队列暂时无法打开，请稍后重试。', 'failed');
                return false;
            }
            await window.AdminTickets.openOverdueQueue();
            emitTicketsFocusFallbackFeedback('超时工单队列已打开');
            return true;
        }

        emitTicketsFocusFallbackFeedback('工单聚焦入口暂未识别，请刷新后台后重试。', 'failed');
        return false;
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
                    runAdminStudioActionFeedback(actionEl, () => changeAdminGalleryPage(page), {
                        loadingText: '加载中...',
                        successText: '已加载',
                        errorText: '加载失败',
                        compact: true,
                        restoreDelayMs: 420,
                        silentErrors: true
                    });
                }
                break;
            }
            case 'gallery-open-prompt-comments':
                runAdminStudioActionFeedback(actionEl, () => openAdminStudioPromptCommentsContext({
                    promptId: decodeURIComponent(actionEl.dataset.promptId || ''),
                    promptTitle: decodeURIComponent(actionEl.dataset.promptTitle || '')
                }), {
                    loadingText: '打开中...',
                    successText: '已打开',
                    errorText: '打开失败',
                    restoreDelayMs: 520,
                    silentErrors: true
                });
                break;
            case 'gallery-open-prompt-analytics':
                runAdminStudioActionFeedback(actionEl, () => openAdminStudioPromptAnalyticsContext(
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    {
                        promptTitle: decodeURIComponent(actionEl.dataset.promptTitle || '')
                    }
                ), {
                    loadingText: '打开中...',
                    successText: '已打开',
                    errorText: '打开失败',
                    restoreDelayMs: 520,
                    silentErrors: true
                });
                break;
            case 'gallery-add-prompt-homepage':
                runAdminStudioActionFeedback(actionEl, () => window.addPromptToHomepagePromptsSection?.(decodeURIComponent(actionEl.dataset.promptId || '')), {
                    loadingText: '加入中...',
                    successText: '已加入',
                    errorText: '加入失败',
                    restoreDelayMs: 650,
                    silentErrors: true
                });
                break;
            case 'gallery-open-prompt-homepage':
                runAdminStudioActionFeedback(actionEl, () => openAdminStudioPromptHomepageContext(
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    { section: 'prompts' }
                ), {
                    loadingText: '打开中...',
                    successText: '已打开',
                    errorText: '打开失败',
                    restoreDelayMs: 520,
                    silentErrors: true
                });
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
            case 'ai-crop-preview': {
                const index = parseInt(actionEl.dataset.previewIndex || '', 10);
                if (!Number.isNaN(index)) {
                    openCropModal(index);
                }
                break;
            }
            case 'switch-comment-view':
                (window.switchAdminCommentsView || window.switchCommentView)?.(actionEl.dataset.commentView);
                break;
            case 'comments-export':
                window.exportData?.(actionEl.dataset.exportFormat, actionEl);
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
            case 'switch-ai-creation-view':
                window.switchAiCreationView?.(actionEl.dataset.aiCreationView);
                break;
            case 'settings-open-points-catalog':
                runAdminStudioActionFeedback(actionEl, async () => {
                    if (window.AdminShell?.openContext) {
                        const opened = await window.AdminShell.openContext('points', {
                            source: 'settings',
                            entity: 'points',
                            action: 'open-catalog',
                            payload: {
                                view: 'catalog'
                            }
                        }, {
                            settleMs: 0,
                            silentDenied: true
                        });
                        if (opened) {
                            return true;
                        }
                    }

                    const switched = window.switchModule?.('points');
                    if (switched === false) {
                        return false;
                    }

                    if (typeof window.openAdminPointsShellContext === 'function') {
                        await window.openAdminPointsShellContext({
                            source: 'settings',
                            entity: 'points',
                            action: 'open-catalog',
                            view: 'catalog'
                        });
                        return true;
                    }

                    window.switchPointsView?.('catalog');
                    return true;
                }, {
                    loadingText: '打开中...',
                    successText: '已打开',
                    errorText: '打开失败',
                    restoreDelayMs: 520,
                    restoreOnNull: true,
                    silentErrors: true,
                    errorMessage: '打开套餐目录失败'
                });
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
            case 'settings-toggle-discount-trigger-section':
                window.handleDiscountTriggerSectionToggle?.(
                    actionEl.dataset.discountTriggerSection,
                    actionEl
                );
                break;
            case 'settings-add-discount-trigger-rule':
                window.handleDiscountTriggerAddRule?.(
                    actionEl.dataset.discountTriggerSection,
                    actionEl
                );
                break;
            case 'settings-apply-discount-trigger-preset':
                window.handleDiscountTriggerApplyPreset?.(
                    actionEl.dataset.discountTriggerSection,
                    actionEl.dataset.discountTriggerPreset,
                    actionEl
                );
                break;
            case 'settings-remove-discount-trigger-rule':
                window.handleDiscountTriggerRemoveRule?.(actionEl);
                break;
            case 'settings-save-discount-trigger-rules':
                void window.handleDiscountTriggerSave?.(actionEl);
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
                runAdminStudioActionFeedback(actionEl, () => (
                    Number.isNaN(index) ? null : window.deleteChannel?.(index)
                ), {
                    loadingText: '删除中...',
                    successText: '已删除',
                    errorText: '删除失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            }
            case 'settings-prompt-api-key':
                window.promptForApiKey?.();
                break;
            case 'settings-delete-api-key':
                runAdminStudioActionFeedback(actionEl, () => window.deleteApiKey?.(), {
                    loadingText: '删除中...',
                    successText: '已删除',
                    errorText: '删除失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-focus-codex-config':
                window.focusCodexConfigPanel?.();
                break;
            case 'settings-prompt-codex-key':
                window.promptForCodexKey?.();
                break;
            case 'settings-save-codex-config':
                runAdminStudioActionFeedback(actionEl, () => window.saveCodexConfig?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-test-codex-config':
                runAdminStudioActionFeedback(actionEl, () => window.testCodexConnectivity?.(), {
                    loadingText: '测试中...',
                    successText: '测试通过',
                    errorText: '测试失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-delete-codex-config':
                runAdminStudioActionFeedback(actionEl, () => window.deleteCodexConfig?.(), {
                    loadingText: '删除中...',
                    successText: '已删除',
                    errorText: '删除失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-prompt-ai-image-model-key':
                window.promptForAiImageModelKey?.();
                break;
            case 'settings-save-ai-image-model-config':
                runAdminStudioActionFeedback(actionEl, () => window.saveAiImageModelConfig?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-test-ai-image-model-provider-full':
                runAdminStudioActionFeedback(actionEl, () => window.testAiImageModelConfig?.(actionEl.dataset.providerId || actionEl.dataset.provider_id || ''), {
                    loadingText: '自检中...',
                    successText: '自检通过',
                    errorText: '自检失败',
                    restoreOnNull: true,
                    silentErrors: true,
                    compact: true
                });
                break;
            case 'settings-discover-ai-image-model-provider':
                runAdminStudioActionFeedback(actionEl, () => window.discoverAiImageModelConfig?.(actionEl.dataset.providerId || actionEl.dataset.provider_id || ''), {
                    loadingText: '检测中...',
                    successText: '已更新模型列表',
                    errorText: '检测失败',
                    restoreOnNull: true,
                    silentErrors: true,
                    compact: true
                });
                break;
            case 'settings-create-ai-image-model-provider':
                window.createAiImageModelProviderDraft?.();
                break;
            case 'settings-save-ai-image-api-base':
                runAdminStudioActionFeedback(actionEl, () => window.saveAiImageApiBaseUrl?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-save-ai-image-guardrails':
                runAdminStudioActionFeedback(actionEl, () => window.saveAiImageGuardrails?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-save-ai-image-storage-policy':
                runAdminStudioActionFeedback(actionEl, () => window.saveAiImageStoragePolicy?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-delete-ai-image-model-config':
                runAdminStudioActionFeedback(actionEl, () => window.deleteAiImageModelConfig?.(actionEl.dataset.providerId || actionEl.dataset.provider_id || ''), {
                    loadingText: '删除中...',
                    successText: '已删除',
                    errorText: '删除失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-select-ai-image-model-provider':
                window.selectAiImageModelProvider?.(actionEl.dataset.providerId || actionEl.dataset.provider_id || '');
                break;
            case 'settings-toggle-ai-image-provider-models':
                window.toggleAiImageModelProviderModels?.(actionEl.dataset.providerId || actionEl.dataset.provider_id || '');
                break;
            case 'settings-clone-ai-image-model-provider':
                window.cloneAiImageModelProvider?.(actionEl.dataset.providerId || actionEl.dataset.provider_id || '');
                break;
            case 'settings-apply-ai-image-discovered-model':
                window.applyAiImageDiscoveredModel?.(actionEl.dataset.model || '', actionEl.dataset.modelGroup || actionEl.dataset.model_group || '', actionEl.dataset.providerId || actionEl.dataset.provider_id || '');
                break;
            case 'settings-classify-ai-image-unknown-model':
                window.classifyAiImageUnknownModel?.(actionEl.dataset.model || '', actionEl.dataset.modelGroup || actionEl.dataset.model_group || '', actionEl.dataset.providerId || actionEl.dataset.provider_id || '');
                break;
            case 'settings-toggle-ai-image-visible-model':
                window.toggleAiImageVisibleModel?.(actionEl.dataset.model || '', actionEl.dataset.modelGroup || actionEl.dataset.model_group || '', actionEl.dataset.providerId || actionEl.dataset.provider_id || '');
                break;
            case 'settings-disable-ai-image-api-base':
                runAdminStudioActionFeedback(actionEl, () => window.disableAiImageApiBaseUrl?.(actionEl.dataset.aiImageApiBaseId), {
                    loadingText: '停用中...',
                    successText: '已停用',
                    errorText: '停用失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-refresh-ai-image-config':
                runAdminStudioActionFeedback(actionEl, () => window.fetchAiImageAdminConfig?.({ force: true }), {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-run-ai-image-worker-once':
                runAdminStudioActionFeedback(actionEl, () => window.runAiImageWorkerOnce?.(), {
                    loadingText: '执行中...',
                    successText: '已执行',
                    errorText: '执行失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-save-ai-image-pricing':
                runAdminStudioActionFeedback(actionEl, () => window.saveAiImagePricingRule?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-new-ai-image-pricing':
                window.resetAiImagePricingEditor?.();
                break;
            case 'settings-select-ai-image-pricing':
                window.selectAiImagePricingRule?.(actionEl.dataset.aiImagePricingId || '');
                break;
            case 'settings-save-ai-image-agent':
                runAdminStudioActionFeedback(actionEl, () => window.saveAiImageAgent?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-disable-ai-image-pricing':
            case 'settings-delete-ai-image-pricing':
                runAdminStudioActionFeedback(actionEl, () => window.deleteAiImagePricingRule?.(actionEl.dataset.aiImagePricingId), {
                    loadingText: '删除中...',
                    successText: '已删除',
                    errorText: '删除失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-disable-ai-image-agent':
                runAdminStudioActionFeedback(actionEl, () => window.disableAiImageAgent?.(actionEl.dataset.aiImageAgentId), {
                    loadingText: '停用中...',
                    successText: '已停用',
                    errorText: '停用失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
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
            case 'settings-toggle-ops-alert-admin-login-anomaly-enabled':
                window.toggleOpsAlertAdminLoginAnomalyEnabled?.();
                break;
            case 'settings-toggle-ops-alert-admin-login-anomaly-ip-grouping':
                window.toggleOpsAlertAdminLoginAnomalyIpGroupingEnabled?.();
                break;
            case 'settings-toggle-ops-alert-admin-login-anomaly-ua-grouping':
                window.toggleOpsAlertAdminLoginAnomalyUserAgentFamilyGroupingEnabled?.();
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
                runAdminStudioActionFeedback(actionEl, () => window.saveOpsAlertSettings?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    silentErrors: true
                });
                break;
            case 'settings-send-ops-alert-telegram-test':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertTelegramTest?.());
                break;
            case 'settings-send-ops-alert-refund-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertRefundSample?.());
                break;
            case 'settings-send-ops-alert-customer-chat-message-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertCustomerChatMessageSample?.());
                break;
            case 'settings-send-ops-alert-shop-purchase-succeeded-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertShopPurchaseSucceededSample?.());
                break;
            case 'settings-send-ops-alert-wallet-recharge-succeeded-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertWalletRechargeSucceededSample?.());
                break;
            case 'settings-send-ops-alert-gateway-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertGatewaySample?.());
                break;
            case 'settings-send-ops-alert-gateway-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertGatewayRecoveredSample?.());
                break;
            case 'settings-send-ops-alert-verify-service-disabled-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertVerifyServiceDisabledSample?.());
                break;
            case 'settings-send-ops-alert-verify-queue-backlog-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertVerifyQueueBacklogSample?.());
                break;
            case 'settings-send-ops-alert-verify-failure-rate-spike-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertVerifyFailureRateSpikeSample?.());
                break;
            case 'settings-send-ops-alert-verify-incident-escalated-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertVerifyIncidentEscalatedSample?.());
                break;
            case 'settings-send-ops-alert-verify-incident-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertVerifyIncidentRecoveredSample?.());
                break;
            case 'settings-send-ops-alert-verify-quota-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertVerifyQuotaSample?.());
                break;
            case 'settings-send-ops-alert-ticket-sla-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertTicketSlaSample?.());
                break;
            case 'settings-send-ops-alert-ticket-sla-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertTicketSlaRecoveredSample?.());
                break;
            case 'settings-send-ops-alert-shop-inventory-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertShopInventorySample?.());
                break;
            case 'settings-send-ops-alert-shop-inventory-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertShopInventoryRecoveredSample?.());
                break;
            case 'settings-send-ops-alert-admin-login-anomaly-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertAdminLoginAnomalySample?.());
                break;
            case 'settings-send-ops-alert-shop-order-delivery-failed-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertShopOrderDeliveryFailedSample?.());
                break;
            case 'settings-send-ops-alert-shop-order-delivery-incident-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertShopOrderDeliveryIncidentSample?.());
                break;
            case 'settings-send-ops-alert-shop-order-delivery-incident-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertShopOrderDeliveryIncidentRecoveredSample?.());
                break;
            case 'settings-send-ops-alert-shop-order-delivery-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertShopOrderDeliveryRecoveredSample?.());
                break;
            case 'settings-send-ops-alert-payment-config-changed-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertPaymentConfigChangedSample?.());
                break;
            case 'settings-send-ops-alert-payment-config-incident-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertPaymentConfigIncidentSample?.());
                break;
            case 'settings-send-ops-alert-payment-config-incident-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertPaymentConfigIncidentRecoveredSample?.());
                break;
            case 'settings-send-ops-alert-payment-config-recovered-sample':
                runAdminStudioOpsAlertSampleAction(actionEl, () => window.sendOpsAlertPaymentConfigRecoveredSample?.());
                break;
            case 'settings-refresh-ops-alert-health':
                runAdminStudioActionFeedback(actionEl, () => window.refreshOpsAlertHealthPanel?.(), {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    silentErrors: true
                });
                break;
            case 'settings-refresh-recovery-readiness':
                runAdminStudioActionFeedback(actionEl, () => window.refreshRecoveryReadinessPanel?.(), {
                    loadingText: '检查中...',
                    successText: '已检查',
                    errorText: '检查失败',
                    silentErrors: true
                });
                break;
            case 'settings-send-external-monitoring-smoke':
                runAdminStudioActionFeedback(actionEl, () => window.sendExternalMonitoringSmokeTest?.(), {
                    loadingText: '发送中...',
                    successText: '已发送',
                    errorText: '发送失败',
                    silentErrors: true
                });
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
                runAdminStudioActionFeedback(actionEl, () => window.refreshOpsAlertMonitorPanel?.(), {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    silentErrors: true
                });
                break;
            case 'settings-batch-claim-ops-alert-monitor':
                runOpsAlertMonitorBatchCaseAction('assign');
                break;
            case 'settings-batch-note-ops-alert-monitor':
                runOpsAlertMonitorBatchCaseAction('add_note');
                break;
            case 'settings-batch-resolve-ops-alert-monitor':
                runOpsAlertMonitorBatchCaseAction('resolve');
                break;
            case 'settings-batch-mute-ops-alert-monitor':
                openOpsAlertMonitorBatchMuteModal();
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
            case 'settings-set-ops-alert-batch-mute-preset':
                window.setOpsAlertBatchMutePreset?.(actionEl.dataset.muteHours);
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
                runAdminStudioActionFeedback(actionEl, () => window.deleteOpsAlertSecret?.(actionEl.dataset.secretName), {
                    loadingText: '删除中...',
                    successText: '已删除',
                    errorText: '删除失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
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
                void openAdminStudioPromptGalleryContext(
                    decodeURIComponent(actionEl.dataset.homepagePromptId || '')
                );
                break;
            case 'homepage-open-featured-comments':
                void openAdminStudioPromptCommentsContext({
                    promptId: decodeURIComponent(actionEl.dataset.homepagePromptId || ''),
                    promptTitle: decodeURIComponent(actionEl.dataset.homepagePromptTitle || '')
                });
                break;
            case 'homepage-open-featured-analytics':
                void openAdminStudioPromptAnalyticsContext(
                    decodeURIComponent(actionEl.dataset.homepagePromptId || ''),
                    {
                        promptTitle: decodeURIComponent(actionEl.dataset.homepagePromptTitle || '')
                    }
                );
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
                runAdminStudioActionFeedback(actionEl, () => window.savePaymentChannelSettings?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    silentErrors: true
                });
                break;
            case 'marketplace-save-channel-settings':
                runAdminStudioActionFeedback(actionEl, () => window.saveMarketplaceChannelSettings?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    silentErrors: true
                });
                break;
            case 'marketplace-run-xianyu-readiness':
                runAdminStudioActionFeedback(actionEl, () => {
                    window.runMarketplaceXianyuReadinessCheck?.();
                    return true;
                }, {
                    loadingText: '自检中...',
                    successText: '已检查',
                    errorText: '自检失败',
                    silentErrors: true
                });
                break;
            case 'marketplace-refresh-xianyu-failures':
                runAdminStudioActionFeedback(actionEl, () => window.loadMarketplaceXianyuRecoveryTasks?.({ force: true, throwOnError: true }), {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    silentErrors: true
                });
                break;
            case 'marketplace-xianyu-delivery-action':
                void window.performMarketplaceXianyuDeliveryAction?.(
                    actionEl.dataset.deliveryTaskId,
                    actionEl.dataset.deliveryTaskCommand,
                    actionEl
                );
                break;
            case 'marketplace-switch-xianyu-tab':
                window.switchMarketplaceXianyuFulfillmentTab?.(actionEl.dataset.xianyuTab);
                break;
            case 'marketplace-toggle-xianyu-enabled':
                window.toggleMarketplaceXianyuEnabled?.();
                break;
            case 'marketplace-toggle-xianyu-account':
                window.toggleMarketplaceXianyuAccount?.(actionEl.dataset.accountKey, actionEl);
                break;
            case 'marketplace-add-xianyu-account':
                window.addMarketplaceXianyuAccount?.();
                break;
            case 'marketplace-remove-xianyu-account':
                window.removeMarketplaceXianyuAccount?.(actionEl.dataset.accountKey, actionEl);
                break;
            case 'marketplace-generate-ingest-token':
                window.generateMarketplaceIngestToken?.(actionEl.dataset.accountKey, actionEl);
                break;
            case 'marketplace-copy-ingest-token':
                window.copyMarketplaceIngestToken?.(actionEl.dataset.accountKey, actionEl);
                break;
            case 'marketplace-add-product-mapping':
                window.addMarketplaceXianyuProductMapping?.();
                break;
            case 'marketplace-remove-product-mapping':
                window.removeMarketplaceXianyuProductMapping?.(actionEl.dataset.mappingIndex);
                break;
            case 'marketplace-add-product-mapping-child':
                window.addMarketplaceXianyuProductMappingChild?.(actionEl.dataset.mappingIndex);
                break;
            case 'marketplace-remove-product-mapping-child':
                window.removeMarketplaceXianyuProductMappingChild?.(actionEl.dataset.mappingIndex);
                break;
            case 'marketplace-toggle-product-mapping':
                window.toggleMarketplaceXianyuProductMapping?.(actionEl.dataset.mappingIndex);
                break;
            case 'marketplace-toggle-product-mapping-collapse':
                if (typeof window.handleMarketplaceXianyuProductMappingCollapseAction === 'function') {
                    window.handleMarketplaceXianyuProductMappingCollapseAction(actionEl, event);
                } else {
                    window.toggleMarketplaceXianyuProductMappingCollapse?.(actionEl.dataset.mappingIndex, actionEl);
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation?.();
                }
                break;
            case 'marketplace-select-product-mapping':
                window.selectMarketplaceProductMapping?.(
                    actionEl.dataset.mappingIndex,
                    actionEl.dataset.productId,
                    actionEl.dataset.productLabel
                );
                break;
            case 'marketplace-clear-product-mapping':
                window.clearMarketplaceProductMapping?.(actionEl.dataset.mappingIndex);
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
                runAdminStudioActionFeedback(actionEl, () => window.AdminPayments?.exportData?.(actionEl.dataset.exportFormat), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    compact: true,
                    silentErrors: true
                });
                break;
            case 'payments-reload':
                runAdminStudioActionFeedback(actionEl, () => window.AdminPayments?.reload?.(), {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    compact: true,
                    silentErrors: true
                });
                break;
            case 'payments-handle-anomaly-action':
                window.AdminPayments?.handleAnomalyAction?.(
                    actionEl.dataset.paymentsTargetType,
                    actionEl.dataset.paymentsTargetId,
                    actionEl.dataset.paymentsAction
                );
                break;
            case 'payments-batch-anomaly-action':
                event.preventDefault();
                event.stopPropagation();
                window.AdminPayments?.handleBatchAnomalyAction?.(
                    actionEl.dataset.paymentsBatchScope,
                    actionEl.dataset.paymentsAction,
                    {
                        applyToAll: actionEl.dataset.paymentsBatchApplyAll === 'true'
                    }
                );
                break;
            case 'payments-toggle-batch-mode':
                event.preventDefault();
                event.stopPropagation();
                window.AdminPayments?.setBatchSelectionMode?.(
                    actionEl.dataset.paymentsBatchScope,
                    actionEl.dataset.paymentsBatchEnabled === 'true'
                );
                break;
            case 'payments-toggle-batch-target':
                window.AdminPayments?.toggleBatchTarget?.(
                    actionEl.dataset.paymentsBatchScope,
                    actionEl.dataset.paymentsTargetType,
                    actionEl.dataset.paymentsTargetId,
                    actionEl.checked === true
                );
                break;
            case 'payments-toggle-batch-scope':
                window.AdminPayments?.toggleBatchScope?.(
                    actionEl.dataset.paymentsBatchScope,
                    actionEl.checked === true
                );
                break;
            case 'payments-go-to-page':
                window.AdminPayments?.goToPage?.(
                    actionEl.dataset.paymentsPageKey,
                    Number(actionEl.dataset.paymentsPage || 0)
                );
                break;
            case 'payments-copy-order-no':
                event.preventDefault();
                event.stopPropagation();
                window.AdminPayments?.copyOrderNo?.(actionEl.dataset.paymentsOrderNo || '');
                break;
            case 'payments-set-exception-topic-filter':
                window.AdminPayments?.setExceptionTopicFilter?.(actionEl.dataset.paymentsTopicKey);
                break;
            case 'payments-focus-exception-topic':
                void openAdminStudioPaymentsFocusContext('focus-exception-topic', actionEl.dataset.paymentsTopicKey);
                break;
            case 'payments-focus-ops-alert-queue':
                void openAdminStudioPaymentsFocusContext('focus-ops-alert-queue');
                break;
            case 'payments-issue-summary-focus':
                void openAdminStudioPaymentsFocusContext('issue-summary-focus', actionEl.dataset.paymentsIssueFocus);
                break;
            case 'payments-priority-focus-order':
                void openAdminStudioPaymentsFocusContext('priority-focus-order', actionEl.dataset.paymentsOrderId);
                break;
            case 'payments-open-shop-order':
                event.preventDefault();
                event.stopPropagation();
                runAdminStudioShopOrderOpenAction(actionEl);
                break;
            case 'payments-priority-focus-topic':
                void openAdminStudioPaymentsFocusContext('priority-focus-topic', actionEl.dataset.paymentsTopicKey);
                break;
            case 'payments-priority-focus-ops':
                void openAdminStudioPaymentsFocusContext('priority-focus-ops');
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
            case 'toggle-theme':
                window.toggleAdminStudioTheme?.(event);
                break;
            case 'analytics-dismiss-alerts':
                window.dismissAllAlerts?.();
                break;
            case 'analytics-switch-tab':
                if (String(actionEl.dataset.tab || '').trim().toLowerCase() === 'product-detail') {
                    window.primeAnalyticsProductDetailSkeletonOnEntry?.();
                }
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
            case 'analytics-toggle-product-detail-dropdown':
                window.toggleAnalyticsProductDetailSelector?.();
                break;
            case 'analytics-select-product-detail-option':
                window.changeAnalyticsProductDetailSelection?.(
                    actionEl.dataset.analyticsProductId || '',
                    {
                        productName: actionEl.dataset.analyticsProductName || '',
                        detailFocus: actionEl.dataset.analyticsDetailFocus || '',
                        focusTargetId: actionEl.dataset.analyticsTargetId || ''
                    }
                );
                break;
            case 'analytics-export-data':
                runAdminStudioActionFeedback(actionEl, () => window.exportAnalyticsData?.(actionEl.dataset.analyticsExportFormat), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    compact: true,
                    silentErrors: true
                });
                break;
            case 'analytics-refresh-data':
                runAdminStudioActionFeedback(actionEl, () => window.refreshAllAnalytics?.(), {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    compact: true,
                    silentErrors: true
                });
                break;
            case 'analytics-toggle-advanced-tools':
                window.toggleAnalyticsAdvancedTools?.();
                break;
            case 'analytics-view-context':
                window.viewPromptContext?.(actionEl.dataset.promptId);
                break;
            case 'analytics-open-prompt-gallery':
                void openAdminStudioPromptGalleryContext(
                    decodeURIComponent(actionEl.dataset.promptId || '')
                );
                break;
            case 'analytics-open-prompt-comments':
                void openAdminStudioPromptCommentsContext({
                    promptId: decodeURIComponent(actionEl.dataset.promptId || ''),
                    promptTitle: decodeURIComponent(actionEl.dataset.promptTitle || '')
                });
                break;
            case 'analytics-open-prompt-homepage':
                void openAdminStudioPromptHomepageContext(
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    { section: 'prompts' }
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
                const parsedAnalyticsContext = typeof parseAnalyticsActionContext === 'function'
                    ? parseAnalyticsActionContext(actionEl.dataset.analyticsContext || '')
                    : {};
                const analyticsContext = parsedAnalyticsContext && typeof parsedAnalyticsContext === 'object' && !Array.isArray(parsedAnalyticsContext)
                    ? parsedAnalyticsContext
                    : {};
                const userEmail = String(
                    actionEl.dataset.userEmail
                    || analyticsContext.userEmail
                    || analyticsContext.user_email
                    || analyticsContext.email
                    || ''
                ).trim();
                const defaultTab = String(analyticsContext.defaultTab || analyticsContext.tab || 'ledger').trim().toLowerCase();
                const verificationId = String(analyticsContext.verificationId || analyticsContext.verification_id || '').trim();
                const ledgerReferenceId = String(
                    analyticsContext.ledgerReferenceId
                    || analyticsContext.ledger_reference_id
                    || verificationId
                    || ''
                ).trim();
                if (!userId) {
                    break;
                }

                if (typeof window.tryOpenOpsAlertWorkspaceUserModal === 'function') {
                    void window.tryOpenOpsAlertWorkspaceUserModal(userId, {
                        notifyDenied: true,
                        analyticsContext,
                        email: userEmail,
                        userEmail,
                        defaultTab,
                        fallbackEmail: userEmail
                    });
                    break;
                }

                void (async () => {
                    if (window.AdminShell?.openContext) {
                        const opened = await window.AdminShell.openContext('users', {
                            source: 'analytics',
                            entity: 'user',
                            action: 'open-user',
                            focus: {
                                userId,
                                user_id: userId,
                                email: userEmail,
                                userEmail,
                                verificationId,
                                verification_id: verificationId,
                                ledgerReferenceId,
                                ledger_reference_id: ledgerReferenceId
                            },
                            payload: {
                                analyticsContext,
                                defaultTab,
                                tab: defaultTab,
                                email: userEmail,
                                userEmail,
                                user_email: userEmail,
                                verificationId,
                                verification_id: verificationId,
                                ledgerReferenceId,
                                ledger_reference_id: ledgerReferenceId,
                                search: userEmail || userId,
                                searchQuery: userEmail || userId,
                                query: userEmail || userId
                            }
                        }, {
                            settleMs: 0,
                            silentDenied: true
                        });
                        if (opened) {
                            return;
                        }
                    }

                    const switched = window.switchModule?.('users');
                    if (switched === false) {
                        return;
                    }

                    if (typeof window.openAdminUsersShellContext === 'function') {
                        await window.openAdminUsersShellContext({
                            source: 'analytics',
                            entity: 'user',
                            action: 'open-user',
                            focus: {
                                userId,
                                user_id: userId,
                                email: userEmail,
                                userEmail,
                                verificationId,
                                verification_id: verificationId,
                                ledgerReferenceId,
                                ledger_reference_id: ledgerReferenceId
                            },
                            payload: {
                                analyticsContext,
                                defaultTab,
                                tab: defaultTab,
                                email: userEmail,
                                userEmail,
                                user_email: userEmail,
                                verificationId,
                                verification_id: verificationId,
                                ledgerReferenceId,
                                ledger_reference_id: ledgerReferenceId,
                                search: userEmail || userId,
                                searchQuery: userEmail || userId,
                                query: userEmail || userId
                            }
                        });
                        return;
                    }

                    window.openUserModal?.(userId, {
                        analyticsContext,
                        defaultTab,
                        fallbackEmail: userEmail
                    });
                })().catch((error) => {
                    console.warn('[AdminStudio] Failed to open analytics user detail:', error);
                });
                break;
            }
            case 'analytics-open-destination':
                window.openAnalyticsDestination?.(
                    actionEl.dataset.analyticsDestination,
                    actionEl.dataset.analyticsContext || ''
                );
                break;
            case 'analytics-product-detail-focus-section': {
                const detailFocus = Object.prototype.hasOwnProperty.call(actionEl.dataset, 'analyticsDetailFocus')
                    ? actionEl.dataset.analyticsDetailFocus
                    : undefined;
                window.focusAnalyticsProductDetailSection?.(
                    actionEl.dataset.analyticsTargetId || '',
                    {
                        detailFocus,
                        productId: actionEl.dataset.analyticsProductId || '',
                        productName: actionEl.dataset.analyticsProductName || '',
                        block: 'start'
                    }
                );
                break;
            }
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
            case 'users-batch-import-tags':
                window.batchImportTagsByEmail?.();
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
                    await openAdminStudioPromptCommentsContext(commentContext);
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
            case 'users-reset-password':
                window.resetUserPassword?.(decodeURIComponent(actionEl.dataset.userId || ''));
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
            case 'users-filter-coupon-status':
                window.setUserCouponStatusFilter?.(actionEl.dataset.couponStatusFilter);
                break;
            case 'users-toggle-coupon-detail':
                window.toggleUserCouponDetail?.(decodeURIComponent(actionEl.dataset.discountAssetId || ''));
                break;
            case 'users-remove-discount-asset':
                window.removeUserDiscountAsset?.(decodeURIComponent(actionEl.dataset.discountAssetId || ''));
                break;
            case 'users-restore-discount-asset':
                window.restoreUserDiscountAsset?.(decodeURIComponent(actionEl.dataset.discountAssetId || ''));
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
            case 'users-change-page':
                window.changeUsersPage?.(actionEl.dataset.usersPage);
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
                runAdminStudioActionFeedback(actionEl, () => window.saveLoginSecuritySettings?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    silentErrors: true
                });
                break;
            case 'settings-refresh-locked-accounts':
                window.refreshLockedAccounts?.();
                break;
            case 'settings-unlock-account':
                runAdminStudioActionFeedback(actionEl, () => window.unlockAccount?.(actionEl.dataset.userId), {
                    loadingText: '解锁中...',
                    successText: '已解锁',
                    errorText: '解锁失败',
                    silentErrors: true
                });
                break;
            case 'settings-unlock-all-accounts':
                runAdminStudioActionFeedback(actionEl, () => window.unlockAllAccounts?.(), {
                    loadingText: '解锁中...',
                    successText: '已解锁',
                    errorText: '解锁失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'settings-save-ip-blacklist':
                runAdminStudioActionFeedback(actionEl, () => window.saveIpBlacklist?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    silentErrors: true
                });
                break;
            case 'settings-check-verify-quota':
                runAdminStudioActionFeedback(actionEl, async () => {
                    const quotaState = await window.checkVerifyQuota?.();
                    return quotaState?.status !== 'error';
                }, {
                    skipButtonFeedback: true,
                    silentErrors: true
                });
                break;
            case 'settings-clean-empty-verify-keys':
                window.cleanZeroBalanceVerifyKeys?.();
                break;
            case 'settings-refresh-verify-monitor':
                runAdminStudioActionFeedback(actionEl, async () => {
                    const state = await window.refreshVerifyMonitor?.(true);
                    return state?.recent?.status !== 'error'
                        && state?.queue?.status !== 'error'
                        && state?.quota?.status !== 'error';
                }, {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    silentErrors: true
                });
                break;
            case 'settings-open-verify-monitor-user': {
                const userId = String(actionEl.dataset.userId || '').trim();
                const userEmail = String(actionEl.dataset.userEmail || '').trim();
                const verificationId = String(actionEl.dataset.verificationId || '').trim();
                const ledgerReferenceId = String(actionEl.dataset.ledgerReferenceId || verificationId).trim();
                const site = String(actionEl.dataset.site || '').trim().toUpperCase();
                const searchValue = userEmail || userId;
                if (!userId && !searchValue) {
                    break;
                }

                const analyticsContext = {
                    contextType: 'verification',
                    verificationId,
                    verification_id: verificationId,
                    ledgerReferenceId,
                    ledger_reference_id: ledgerReferenceId,
                    userId,
                    user_id: userId,
                    userEmail,
                    user_email: userEmail,
                    email: userEmail,
                    site,
                    defaultTab: 'ledger',
                    tab: 'ledger',
                    autoOpenLedgerDetail: true,
                    auto_open_ledger_detail: true,
                    sourceLabel: 'Google One API',
                    signalLabel: '验证任务',
                    referenceLabel: '验证单号',
                    referenceValue: verificationId || ledgerReferenceId
                };

                if (typeof window.tryOpenOpsAlertWorkspaceUserModal === 'function') {
                    void window.tryOpenOpsAlertWorkspaceUserModal(userId, {
                        source: 'verify-monitor',
                        notifyDenied: true,
                        analyticsContext,
                        email: userEmail,
                        userEmail,
                        defaultTab: 'ledger',
                        fallbackEmail: userEmail
                    });
                    break;
                }

                void (async () => {
                    const usersContext = {
                        source: 'verify-monitor',
                        entity: 'user',
                        action: 'open-user',
                        focus: {
                            userId,
                            user_id: userId,
                            email: userEmail,
                            userEmail,
                            verificationId,
                            verification_id: verificationId,
                            ledgerReferenceId,
                            ledger_reference_id: ledgerReferenceId
                        },
                        payload: {
                            analyticsContext,
                            defaultTab: 'ledger',
                            tab: 'ledger',
                            email: userEmail,
                            userEmail,
                            user_email: userEmail,
                            fallbackEmail: userEmail,
                            verificationId,
                            verification_id: verificationId,
                            ledgerReferenceId,
                            ledger_reference_id: ledgerReferenceId,
                            search: searchValue,
                            searchQuery: searchValue,
                            query: searchValue
                        }
                    };

                    if (window.AdminShell?.openContext) {
                        const opened = await window.AdminShell.openContext('users', usersContext, {
                            settleMs: 0,
                            silentDenied: true
                        });
                        if (opened) {
                            return;
                        }
                    }

                    const switched = window.switchModule?.('users');
                    if (switched === false) {
                        return;
                    }

                    if (typeof window.openAdminUsersShellContext === 'function') {
                        await window.openAdminUsersShellContext(usersContext);
                        return;
                    }

                    if (userId && typeof window.openUserModal === 'function') {
                        await window.openUserModal(userId, {
                            analyticsContext,
                            defaultTab: 'ledger',
                            fallbackEmail: userEmail
                        });
                    }
                })().catch((error) => {
                    console.warn('[AdminStudio] Failed to open verify monitor submitter:', error);
                });
                break;
            }
            case 'settings-refocus-verify-monitor': {
                const focusContext = typeof window.readOpsAlertWorkspaceContextDataset === 'function'
                    ? window.readOpsAlertWorkspaceContextDataset(actionEl.dataset)
                    : {};
                window.focusVerifyMonitorWorkspace?.(focusContext);
                break;
            }
            case 'settings-scroll-focus-target': {
                const focusTargetId = String(actionEl.dataset.focusTargetId || '').trim();
                const focusTarget = focusTargetId ? document.getElementById(focusTargetId) : null;
                const scrollTarget = focusTarget?.closest?.('section, .settings-section, .admin-audit-monitor-panel, .verify-monitor-card') || focusTarget;
                if (scrollTarget instanceof HTMLElement) {
                    scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    scrollTarget.classList.remove('admin-workbench-focus-target--active');
                    void scrollTarget.offsetWidth;
                    scrollTarget.classList.add('admin-workbench-focus-target--active');
                    window.clearTimeout(scrollTarget._adminWorkbenchFocusTargetTimer);
                    scrollTarget._adminWorkbenchFocusTargetTimer = window.setTimeout(() => {
                        scrollTarget.classList.remove('admin-workbench-focus-target--active');
                    }, 1800);
                }
                break;
            }
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
                runAdminStudioActionFeedback(actionEl, async () => {
                    const result = await window.refreshAdminAuditMonitor?.(true);
                    return result !== null && result !== false;
                }, {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    silentErrors: true
                });
                break;
            case 'settings-refocus-admin-audit-monitor': {
                const focusContext = typeof window.readOpsAlertWorkspaceContextDataset === 'function'
                    ? window.readOpsAlertWorkspaceContextDataset(actionEl.dataset)
                    : {};
                window.focusAdminAuditMonitorWorkspace?.(focusContext);
                break;
            }
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
            case 'settings-select-announcement-rule':
                window.selectAnnouncementRule?.(actionEl.dataset.announcementRuleId);
                break;
            case 'settings-new-announcement-rule':
                window.newAnnouncementRule?.();
                break;
            case 'settings-set-announcement-status-filter':
                window.setAnnouncementRuleStatusFilter?.(actionEl.dataset.announcementStatusFilter);
                break;
            case 'settings-toggle-announcement-select':
                window.toggleAnnouncementCustomSelect?.(actionEl.dataset.announcementSelectId);
                break;
            case 'settings-select-announcement-select-option':
                window.selectAnnouncementCustomSelectOption?.(
                    actionEl.dataset.announcementSelectId,
                    actionEl.dataset.announcementSelectValue
                );
                break;
            case 'settings-toggle-announcement-datetime':
                window.toggleAnnouncementDateTimePicker?.(actionEl.dataset.announcementDatetimeId);
                break;
            case 'settings-confirm-announcement-datetime':
                window.confirmAnnouncementDateTimePicker?.(actionEl.dataset.announcementDatetimeId);
                break;
            case 'settings-clear-announcement-datetime':
                window.clearAnnouncementDateTimePicker?.(actionEl.dataset.announcementDatetimeId);
                break;
            case 'settings-submit-announcement-review':
                void window.submitAnnouncementReview?.(actionEl);
                break;
            case 'settings-approve-announcement':
                void window.approveAnnouncementRule?.(actionEl);
                break;
            case 'settings-reject-announcement':
                void window.rejectAnnouncementRule?.(actionEl);
                break;
            case 'settings-archive-announcement':
                void window.archiveAnnouncementRule?.(actionEl);
                break;
            case 'settings-copy-default-announcement':
                window.copyDefaultAnnouncementToScope?.();
                break;
            case 'settings-clear-page-announcement':
                window.clearAnnouncementScopeOverride?.();
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
                void window.saveAnnouncement?.(actionEl);
                break;
            case 'settings-save-sensitive-words':
                runAdminStudioActionFeedback(actionEl, () => window.saveSensitiveWords?.(), {
                    loadingText: '保存中...',
                    successText: '已保存',
                    errorText: '保存失败',
                    silentErrors: true
                });
                break;
            case 'discounts-filter':
                window.AdminDiscounts?.filter?.(actionEl.dataset.discountStatus, actionEl);
                break;
            case 'discounts-open-generate-modal':
                window.AdminDiscounts?.openGenerateModal?.();
                break;
            case 'discounts-export-filtered-audit-summaries':
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.exportFilteredAuditSummaries?.(), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
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
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.loadBatchRestoreHistory?.({ force: true }), {
                    loadingText: '刷新中...',
                    successText: '已刷新',
                    errorText: '刷新失败',
                    silentErrors: true
                });
                break;
            case 'discounts-copy-batch-restore-result-summary':
                void window.AdminDiscounts?.copyBatchRestoreSummary?.();
                break;
            case 'discounts-export-batch-restore-result-summary':
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.exportBatchRestoreSummary?.(), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'discounts-copy-batch-restore-failed-summary':
                void window.AdminDiscounts?.copyBatchRestoreFailedSummary?.();
                break;
            case 'discounts-export-batch-restore-failed-summary':
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.exportBatchRestoreFailedSummary?.(), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'discounts-copy-history-run-summary':
                void window.AdminDiscounts?.copyBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'all');
                break;
            case 'discounts-export-history-run-summary':
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.exportBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'all'), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'discounts-copy-history-run-failed-summary':
                void window.AdminDiscounts?.copyBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'failed');
                break;
            case 'discounts-export-history-run-failed-summary':
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.exportBatchRestoreHistoryRunSummary?.(actionEl.dataset.discountBatchRunId || '', 'failed'), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
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
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.assignAssetsFromDetail?.(actionEl.dataset.discountId || ''), {
                    loadingText: '发放中...',
                    successText: '已发放',
                    errorText: '发放失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
                break;
            case 'discounts-copy-code':
                window.AdminDiscounts?.copyCode?.(actionEl.dataset.discountCode || '');
                break;
            case 'discounts-copy-audit-summary':
                void window.AdminDiscounts?.copyAuditSummary?.();
                break;
            case 'discounts-export-audit-summary':
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.exportAuditSummary?.(), {
                    loadingText: '导出中...',
                    successText: '已导出',
                    errorText: '导出失败',
                    restoreOnNull: true,
                    silentErrors: true
                });
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
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.toggleStatus?.(
                    actionEl.dataset.discountId,
                    actionEl.dataset.discountNextActive === 'true'
                ), {
                    loadingText: '更新中...',
                    successText: '已更新',
                    errorText: '更新失败',
                    compact: true,
                    silentErrors: true
                });
                break;
            case 'discounts-delete-code':
                runAdminStudioActionFeedback(actionEl, () => window.AdminDiscounts?.deleteCode?.(
                    actionEl.dataset.discountId,
                    actionEl.dataset.discountCode || ''
                ), {
                    loadingText: '删除中...',
                    successText: '已删除',
                    errorText: '删除失败',
                    compact: true,
                    restoreOnNull: true,
                    silentErrors: true
                });
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
                void openAdminStudioTicketsFocusContext('issue-summary-focus', actionEl.dataset.ticketIssueFocus);
                break;
            case 'tickets-priority-open':
                void openAdminStudioTicketsFocusContext('priority-open', actionEl.dataset.ticketId);
                break;
            case 'tickets-priority-resolve':
                void openAdminStudioTicketsFocusContext('priority-resolve', actionEl.dataset.ticketId);
                break;
            case 'tickets-priority-reject':
                void openAdminStudioTicketsFocusContext('priority-reject', actionEl.dataset.ticketId);
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
                void openAdminStudioTicketsFocusContext('open-overdue-queue');
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
                window.AdminTickets?.submitBulkAssignment?.('assign_self', actionEl);
                break;
            case 'tickets-bulk-clear-assignee':
                window.AdminTickets?.submitBulkAssignment?.('clear', actionEl);
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
            if (target.id === 'aiImageModelVendorInput' || target.id === 'aiImageModelProtocolInput') {
                window.handleAiImageModelProviderDraftInput?.(target);
            }
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
                changeAdminGalleryPage(nextPage);
                break;
            }
            case 'payments-change-active-provider':
                window.handlePaymentChannelActiveChange?.(actionEl.value);
                break;
            case 'marketplace-change-default-account':
                window.handleMarketplaceXianyuDefaultAccountChange?.(actionEl.value);
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
            case 'settings-filter-announcement-rules':
                window.handleAnnouncementRuleFilterChange?.();
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
            case 'marketplace-open-product-mapping':
                window.openMarketplaceProductPicker?.(actionEl.dataset.mappingIndex);
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
            case 'settings-filter-announcement-rules':
                window.handleAnnouncementRuleFilterChange?.();
                break;
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
            case 'marketplace-search-product-mapping':
                window.searchMarketplaceProductPickerOptions?.(
                    actionEl.dataset.mappingIndex,
                    actionEl.value
                );
                break;
            case 'settings-edit-ai-image-model-provider':
                window.handleAiImageModelProviderDraftInput?.(actionEl);
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
        const closeButton = target?.closest?.('[data-admin-large-modal-close]');
        if (!(closeButton instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        closeAdminStudioLargeModalFromButton(closeButton);
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

        window.AdminOverlayDismissGuard?.bind?.(overlay);

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

        if (!window.AdminOverlayDismissGuard?.shouldDismiss?.(overlay, event)) {
            return;
        }

        closeAdminStudioOverlayByKey(overlay.dataset.adminOverlayClose);
    });
}

const ADMIN_STUDIO_LARGE_MODAL_CLOSE_RULES = [
    { overlay: '[data-admin-overlay-close="user-modal"]', panel: '#userModal' },
    { overlay: '[data-admin-overlay-close="ticket-summary-job-detail-modal"]', panel: '.admin-ticket-summary-job-modal__dialog' },
    { overlay: '[data-admin-overlay-close="ticket-reply-modal"]', panel: '.admin-ticket-reply-modal__panel' },
    { overlay: '[data-admin-overlay-close="ticket-bulk-process-modal"]', panel: '.admin-ticket-bulk-modal__panel' },
    { overlay: '[data-admin-overlay-close="discount-generate-modal"]', panel: '.admin-discount-form-modal__dialog' },
    { overlay: '[data-admin-overlay-close="discount-detail-modal"]', panel: '.admin-discount-detail-dialog' },
    { overlay: '[data-admin-overlay-close="discount-restore-modal"]', panel: '.admin-discount-restore-dialog' },
    { overlay: '[data-admin-overlay-close="discount-batch-restore-modal"]', panel: '.admin-discount-restore-dialog' },
    { overlay: '[data-admin-overlay-close="discount-batch-restore-result-modal"]', panel: '.admin-discount-restore-dialog' },
    { overlay: '[data-admin-overlay-close="discount-batch-restore-history-modal"]', panel: '.admin-discount-restore-dialog' },
    { overlay: '[data-admin-overlay-close="discount-batch-restore-history-run-detail-modal"]', panel: '.admin-discount-restore-dialog' },
    { overlay: '[data-admin-overlay-close="shop-risk-case-modal"]', panel: '.admin-shop-risk-case-modal__dialog' },
    { overlay: '[data-admin-overlay-close="ops-alert-batch-mute-modal"]', panel: '.admin-shop-risk-case-modal__dialog' },
    { overlay: '[data-admin-overlay-close="crop-modal"]', panel: '.crop-modal' },
    { overlay: '[data-admin-overlay-close="inventory-release-modal"]', panel: '.admin-studio-inline-style-attr-122' },
    { overlay: '[data-admin-overlay-close="inventory-import-modal"]', panel: '.admin-studio-inline-style-attr-131' },
    { overlay: '[data-shop-overlay-close="product-modal"]', panel: '.premium-modal-layout' },
    { overlay: '[data-shop-overlay-close="dynamic-modal"]', panel: '.shop-order-content-modal' },
    { overlay: '[data-shop-overlay-close="dynamic-modal"]', panel: '.shop-refund-modal' },
    { overlay: '[data-shop-overlay-close="dynamic-modal"]', panel: '.shop-inventory-detail-modal' },
    { overlay: '[data-shop-overlay-close="dynamic-modal"]', panel: '.shop-inventory-fault-modal' },
    { overlay: '[data-points-overlay-close="delete-options"]', panel: '.points-delete-options-modal' },
    { overlay: '[data-points-overlay-close="codes"]', panel: '.codes-modal' },
    { overlay: '[data-points-overlay-close="batch-edit"]', panel: '.edit-modal--batch' },
    { overlay: '[data-points-overlay-close="package-delete"]', panel: '.edit-modal--package-delete' },
    { overlay: '[data-points-overlay-close="code-action"]', panel: '.edit-modal--code-action' },
    { overlay: '[data-points-overlay-close="batch-invalidate"]', panel: '.edit-modal--batch-invalidate' }
];

function closeAdminStudioOverlayByKey(key = '') {
    switch (key) {
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
}

function closeAdminStudioLargeModalFromButton(closeButton) {
    const overlay = closeButton.closest('[data-admin-overlay-close], [data-shop-overlay-close], [data-points-overlay-close]');
    if (!(overlay instanceof HTMLElement)) {
        return;
    }

    if (overlay.hasAttribute('data-admin-overlay-close')) {
        closeAdminStudioOverlayByKey(overlay.dataset.adminOverlayClose || '');
        return;
    }

    if (overlay.hasAttribute('data-shop-overlay-close')) {
        if (overlay.dataset.shopOverlayClose === 'product-modal') {
            window.ShopAdmin?.hideProductModal?.();
            return;
        }
        if (overlay.dataset.shopOverlayClose === 'dynamic-modal') {
            window.ShopAdmin?.closeDynamicModal?.(overlay.dataset.modalId);
            return;
        }
    }

    if (overlay.hasAttribute('data-points-overlay-close')) {
        const existingCloseButton = overlay.querySelector(':is([data-points-action="close-delete-options"], [data-points-action="close-codes-modal"], [data-points-action="close-batch-edit"], [data-points-action="close-package-delete-modal"], [data-points-action="close-code-action-modal"], [data-points-action="close-batch-invalidate-modal"])');
        if (existingCloseButton instanceof HTMLElement && existingCloseButton !== closeButton) {
            existingCloseButton.click();
            return;
        }
        if (overlay.dataset.pointsOverlayClose === 'codes') {
            window.closeCodesModal?.();
            return;
        }
    }

    overlay.classList.remove('active', 'is-visible');
    overlay.setAttribute('aria-hidden', 'true');
}

function handleAdminStudioLargeModalCloseActivation(event) {
    const closeButton = event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : event.target?.closest?.('[data-admin-large-modal-close]');
    if (!(closeButton instanceof HTMLElement)) {
        return;
    }
    if (event.type === 'pointerup' && typeof event.button === 'number' && event.button !== 0) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeAdminStudioLargeModalFromButton(closeButton);
}

function bindAdminStudioLargeModalCloseButton(button) {
    if (!(button instanceof HTMLElement) || button.dataset.adminLargeModalTouchBound === '1') {
        return;
    }

    button.dataset.adminLargeModalTouchBound = '1';
    button.addEventListener('click', handleAdminStudioLargeModalCloseActivation);
    button.addEventListener('pointerup', handleAdminStudioLargeModalCloseActivation);
    button.addEventListener('touchend', handleAdminStudioLargeModalCloseActivation, { passive: false });
}

function collectAdminStudioLargeModalOverlays(root, selector) {
    const overlays = [];
    if (root instanceof Element && root.matches(selector)) {
        overlays.push(root);
    }
    if (typeof root?.querySelectorAll === 'function') {
        root.querySelectorAll(selector).forEach((overlay) => overlays.push(overlay));
    }
    return overlays;
}

function ensureAdminStudioLargeModalCloseButton(panel) {
    if (!(panel instanceof HTMLElement)) {
        return;
    }

    panel.classList.add('admin-studio-large-modal-panel');
    const overlay = panel.closest('[data-admin-overlay-close], [data-shop-overlay-close], [data-points-overlay-close]');
    if (overlay instanceof HTMLElement) {
        window.AdminOverlayDismissGuard?.bind?.(overlay);
        overlay.classList.add('admin-studio-large-modal-overlay');
        if (overlay.dataset.shopOverlayClose === 'product-modal') {
            panel.dataset.adminLargeModalKind = 'shop-product';
        }
    }

    const existingButton = panel.querySelector(':scope > [data-admin-large-modal-close]');
    if (existingButton instanceof HTMLElement) {
        bindAdminStudioLargeModalCloseButton(existingButton);
        return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-studio-large-modal-close';
    button.setAttribute('data-admin-large-modal-close', 'true');
    button.setAttribute('aria-label', '关闭弹窗');
    button.setAttribute('title', '关闭弹窗');
    if (overlay instanceof HTMLElement && overlay.dataset.shopOverlayClose === 'product-modal') {
        button.setAttribute('data-shop-action', 'product-close-modal');
    }
    button.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
    bindAdminStudioLargeModalCloseButton(button);
    panel.appendChild(button);
}

function enhanceAdminStudioLargeModalCloseButtons(root = document) {
    ADMIN_STUDIO_LARGE_MODAL_CLOSE_RULES.forEach((rule) => {
        collectAdminStudioLargeModalOverlays(root, rule.overlay).forEach((overlay) => {
            const panel = overlay.querySelector(rule.panel);
            ensureAdminStudioLargeModalCloseButton(panel);
        });
    });
}

function initAdminStudioLargeModalCloseEnhancer() {
    enhanceAdminStudioLargeModalCloseButtons(document);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node instanceof Element) {
                    enhanceAdminStudioLargeModalCloseButtons(node);
                }
            });
            if (mutation.type === 'childList' && mutation.target instanceof Element) {
                enhanceAdminStudioLargeModalCloseButtons(mutation.target);
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.refreshAdminStudioLargeModalCloseButtons = enhanceAdminStudioLargeModalCloseButtons;
}

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
    const importTab = document.querySelector('[data-view="import"]');
    if (importTab) {
        importTab.hidden = !hasPermission('prompts.manage');
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
    { configId: 'ops-alerts-kvm4', bucket: 'monitors-side' },
    { configId: 'ops-alerts-shop-risk', bucket: 'monitors-side' },
    { configId: 'ops-alerts-admin-login-anomaly', bucket: 'monitors-main' },
    { configId: 'ops-alerts-monitor', bucket: 'workspace-main' },
    { configId: 'ops-alerts-workspace', bucket: 'workspace-main' },
    { configId: 'ops-alerts-health', bucket: 'health-main' },
    { configId: 'ops-alerts-recovery-readiness', bucket: 'health-main' }
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

// Switch between Gallery views
function switchView(viewName) {
    const galleryModule = document.getElementById('module-gallery');
    if (!galleryModule) return;
    const requestedView = String(viewName || '').trim().toLowerCase();
    const normalizedView = GALLERY_VIEW_NAMES.has(requestedView) ? requestedView : 'create';

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
            ? (getPendingAdminGalleryFocusPromptId() || getAdminGalleryRouteState().promptId || '')
            : ''
    });

    // Load data if switching to Manage view
    if (normalizedView === 'manage') {
        renderGallerySiteContextBanner();
        loadAdminPrompts({ allowCached: true });
    } else if (normalizedView === 'import') {
        initGalleryImportAssistant();
        setAdminGalleryLoadingChrome(false);
    } else {
        setAdminGalleryLoadingChrome(false);
    }
}

window.switchView = switchView;

const AI_CREATION_DEFAULT_VIEW = 'overview';
const AI_CREATION_VIEW_NAMES = new Set([
    'overview',
    'models',
    'user-api',
    'pricing',
    'guardrails',
    'storage',
    'agents'
]);

function normalizeAiCreationViewName(viewName = '') {
    const normalized = String(viewName || '').trim().toLowerCase();
    return AI_CREATION_VIEW_NAMES.has(normalized) ? normalized : AI_CREATION_DEFAULT_VIEW;
}

function resolveAiCreationViewName(context = {}, options = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const payload = normalizedContext.payload && typeof normalizedContext.payload === 'object' ? normalizedContext.payload : {};
    const raw = normalizedContext.raw && typeof normalizedContext.raw === 'object' ? normalizedContext.raw : {};
    const requestedView = (
        payload.view
        || payload.defaultTab
        || payload.tab
        || raw.view
        || raw.defaultTab
        || raw.tab
        || normalizedContext.view
        || normalizedContext.defaultTab
        || normalizedContext.tab
        || options.viewName
        || options.aiCreationView
        || ''
    );
    return requestedView ? normalizeAiCreationViewName(requestedView) : '';
}

function ensureAiCreationPanelMounted() {
    const mount = document.getElementById('aiCreationPanelMount');
    const source = document.getElementById('aiCreationPanelSource');
    if (!mount) return null;

    const mountedPanel = mount.querySelector('.ai-image-admin-layout');
    if (mountedPanel) return mountedPanel;

    const sourcePanel = source?.querySelector?.('.ai-image-admin-layout');
    if (!sourcePanel) return null;

    mount.appendChild(sourcePanel);
    if (source) {
        source.hidden = true;
    }
    return sourcePanel;
}

function getActiveAiCreationViewName() {
    const aiCreationModule = document.getElementById('module-ai-creation');
    const activeTab = aiCreationModule?.querySelector('.admin-tab[data-ai-creation-view].active');
    return normalizeAiCreationViewName(activeTab?.dataset?.aiCreationView);
}

function switchAiCreationView(viewName = AI_CREATION_DEFAULT_VIEW, options = {}) {
    const normalizedView = normalizeAiCreationViewName(viewName);
    const panel = ensureAiCreationPanelMounted();
    const aiCreationModule = document.getElementById('module-ai-creation');
    if (!panel || !aiCreationModule) return false;

    aiCreationModule.querySelectorAll('.admin-tab[data-ai-creation-view]').forEach(tab => {
        const isActive = tab.dataset.aiCreationView === normalizedView;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) {
            updateAdminTabIndicator(tab);
        }
    });

    panel.querySelectorAll('[data-ai-creation-panel]').forEach(card => {
        const cardView = normalizeAiCreationViewName(card.dataset.aiCreationPanel);
        const isActive = cardView === normalizedView;
        card.toggleAttribute('hidden', !isActive);
        card.classList.toggle('active', isActive);
    });

    if (options.render !== false) {
        renderAiImageAdminPanel();
    }
    return true;
}

async function initAiCreationModule(context = {}, options = {}) {
    const viewName = resolveAiCreationViewName(context, options) || getActiveAiCreationViewName();
    ensureAiCreationPanelMounted();
    switchAiCreationView(viewName, { render: false });
    renderAiImageAdminPanel();

    if (!adminAiImageState.loaded || options.force === true) {
        await fetchAiImageAdminConfig({ force: options.force === true });
    }

    return true;
}

async function handleAiCreationShellContext(context = {}, options = {}) {
    return initAiCreationModule(context, options);
}

async function handleAiCreationSiteChange() {
    const moduleEl = document.getElementById('module-ai-creation');
    if (!moduleEl?.classList.contains('active') || moduleEl.hidden) {
        return false;
    }
    await fetchAiImageAdminConfig({ force: true });
    return true;
}

// Switch between Settings sub-views (Pricing / General)
function switchSettingsView(viewName, options = {}) {
    const normalizedViewName = typeof window.normalizeSettingsViewName === 'function'
        ? window.normalizeSettingsViewName(viewName)
        : String(viewName || '').trim().toLowerCase();

    if (normalizedViewName === 'ai-image') {
        window.switchModule?.('ai-creation', {
            aiCreationView: options?.aiCreationView || AI_CREATION_DEFAULT_VIEW,
            force: options?.force === true,
            reason: 'legacy-ai-image-settings-view'
        });
        return;
    }

    // Update active tab in settings module only
    const settingsModule = document.getElementById('module-settings');
    if (!settingsModule) return;

    settingsModule.querySelectorAll('.admin-tab').forEach(tab => {
        const isActive = tab.dataset.settingsView === normalizedViewName;
        tab.classList.toggle('active', isActive);

        if (isActive) {
            updateAdminTabIndicator(tab);
        }
    });

    // Update view visibility within settings
    settingsModule.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    const targetView = document.getElementById(`settings-view-${normalizedViewName}`);
    if (targetView) targetView.classList.add('active');

    // Load API keys when switching to general
    if (normalizedViewName === 'general') {
        renderApiKeySelector();
    }

    if (options?.warm !== false) {
        void window.warmSettingsViewConfigInBackground?.({
            viewName: normalizedViewName,
            force: options?.force === true
        });
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
    document.querySelectorAll('.admin-tabs, #module-shop .shop-tabs, #module-tickets .admin-ticket-function-nav').forEach(nav => {
        const activeTab = nav.querySelector('.admin-tab.active, .shop-tab.active, .admin-ticket-function-tab.active');
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
document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.admin-tabs .admin-tab, #module-shop .shop-tabs .shop-tab, #module-tickets .admin-ticket-function-tab, [data-admin-action="switch-module"]')) {
        return;
    }

    requestAnimationFrame(initIndicator);
});

// Update Admin Tab Indicator Position
// 20260427_ADMIN_STUDIO_NAV_INDICATOR_SLIDE_RUNTIME_1
function updateAdminTabIndicator(activeTab) {
    if (!activeTab) return;
    const nav = activeTab.closest('.admin-tabs, #module-shop .shop-tabs, #module-tickets .admin-ticket-function-nav');
    const indicator = nav?.querySelector('.admin-tab-indicator');
    if (!nav) return;

    const navRect = nav.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    const width = Math.max(0, Math.round(tabRect.width));
    if (!width || !navRect.width) {
        nav.style.setProperty('--admin-tab-indicator-width', '0px');
        nav.style.setProperty('--admin-tab-indicator-left', '0px');
        indicator?.style?.setProperty('--admin-tab-indicator-width', '0px');
        indicator?.style?.setProperty('--admin-tab-indicator-left', '0px');
        indicator?.classList?.remove('is-visible');
        return;
    }

    const left = Math.max(0, Math.round(tabRect.left - navRect.left + nav.scrollLeft));
    nav.style.setProperty('--admin-tab-indicator-width', `${width}px`);
    nav.style.setProperty('--admin-tab-indicator-left', `${left}px`);
    indicator?.style?.setProperty('--admin-tab-indicator-width', `${width}px`);
    indicator?.style?.setProperty('--admin-tab-indicator-left', `${left}px`);
    indicator?.classList?.add('is-visible');
}
window.updateAdminTabIndicator = updateAdminTabIndicator;

function getGalleryActiveViewName() {
    const activeId = document.querySelector('#module-gallery .view-section.active')?.id || '';
    if (activeId === 'view-manage') return 'manage';
    if (activeId === 'view-import') return 'import';
    return 'create';
}

function isGalleryManageViewActive() {
    return getGalleryActiveViewName() === 'manage';
}

function isGalleryImportViewActive() {
    return getGalleryActiveViewName() === 'import';
}

function normalizeAdminGallerySite(site = getAdminPromptsReadSite()) {
    const normalized = String(site || '').trim().toLowerCase();
    return normalized === 'cn' || normalized === 'intl' ? normalized : 'all';
}

function getAdminGalleryListParams(overrides = {}) {
    const searchInput = document.getElementById('adminSearchInput');
    const sortValue = normalizeAdminGallerySortValue(document.getElementById('sortFilter')?.value || adminGalleryViewState.sortValue);

    adminGalleryViewState.sortValue = sortValue;

    return {
        site: normalizeAdminGallerySite(overrides.site || getAdminPromptsReadSite()),
        page: normalizeAdminGalleryPage(overrides.page ?? adminGalleryViewState.page, 1),
        pageSize: normalizeAdminGalleryPage(overrides.pageSize ?? adminGalleryViewState.pageSize, ADMIN_GALLERY_PAGE_SIZE),
        search: Object.prototype.hasOwnProperty.call(overrides, 'search')
            ? String(overrides.search || '').trim()
            : String(searchInput?.value || adminGalleryViewState.searchQuery || '').trim(),
        category: Object.prototype.hasOwnProperty.call(overrides, 'category')
            ? String(overrides.category || '').trim()
            : String(document.getElementById('categoryFilter')?.value || '').trim(),
        date: Object.prototype.hasOwnProperty.call(overrides, 'date')
            ? String(overrides.date || '').trim()
            : String(document.getElementById('dateFilter')?.value || '').trim(),
        language: Object.prototype.hasOwnProperty.call(overrides, 'language')
            ? String(overrides.language || '').trim()
            : String(document.getElementById('languageFilter')?.value || '').trim(),
        status: Object.prototype.hasOwnProperty.call(overrides, 'status')
            ? String(overrides.status || '').trim()
            : String(document.getElementById('statusFilter')?.value || '').trim(),
        sort: Object.prototype.hasOwnProperty.call(overrides, 'sort')
            ? normalizeAdminGallerySortValue(overrides.sort)
            : sortValue
    };
}

function getAdminGalleryListQueryKey(site = getAdminPromptsReadSite(), params = {}) {
    const normalizedParams = params && typeof params === 'object' ? params : {};
    return JSON.stringify({
        site: normalizeAdminGallerySite(site),
        page: normalizeAdminGalleryPage(normalizedParams.page, 1),
        pageSize: normalizeAdminGalleryPage(normalizedParams.pageSize, ADMIN_GALLERY_PAGE_SIZE),
        search: String(normalizedParams.search || '').trim().toLowerCase(),
        category: String(normalizedParams.category || '').trim().toLowerCase(),
        date: String(normalizedParams.date || '').trim().toLowerCase(),
        language: String(normalizedParams.language || '').trim().toLowerCase(),
        status: String(normalizedParams.status || '').trim().toLowerCase(),
        sort: normalizeAdminGallerySortValue(normalizedParams.sort)
    });
}

function hasFreshAdminGalleryPromptList(site = getAdminPromptsReadSite(), queryKey = '') {
    const normalizedSite = normalizeAdminGallerySite(site);
    if (
        !adminGalleryLoadState.loaded
        || adminGalleryLoadState.site !== normalizedSite
        || (queryKey && adminGalleryLoadState.queryKey !== queryKey)
    ) {
        return false;
    }

    return (Date.now() - adminGalleryLoadState.loadedAt) <= ADMIN_GALLERY_LIST_REFRESH_TTL_MS;
}

function markAdminGalleryPromptListLoaded(site = getAdminPromptsReadSite(), queryKey = '') {
    adminGalleryLoadState.site = normalizeAdminGallerySite(site);
    adminGalleryLoadState.queryKey = queryKey || adminGalleryLoadState.queryKey || '';
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
            adminGalleryLoadState.queryKey = '';
        }
    }
}

function isCurrentAdminGalleryLoadRequest(site = getAdminPromptsReadSite(), requestId = adminGalleryLoadState.requestId) {
    return adminGalleryLoadState.requestId === requestId
        && adminGalleryLoadState.site === normalizeAdminGallerySite(site);
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
    adminGalleryViewState.page = 1;
    adminGalleryViewState.sortValue = 'updated-desc';
    setAdminGalleryFilterDropdownValue('categoryFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('dateFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('languageFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('statusFilterDropdown', '');
    setAdminGalleryFilterDropdownValue('sortFilterDropdown', 'updated-desc');
}

function queueAdminGalleryPromptFocus(promptId = '') {
    setPendingAdminGalleryFocusPromptId(promptId);
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
    void loadAdminPrompts({
        force: true,
        resetPage: true,
        preferFastRender: true,
        replaceExisting: true
    });
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

function sortAdminGalleryCards(sortValue = getAdminGallerySortValue(), rows = allPrompts) {
    const safeRows = Array.isArray(rows) ? [...rows] : [];
    safeRows.sort((leftPrompt, rightPrompt) => compareAdminGalleryPrompts(leftPrompt, rightPrompt, sortValue));
    return safeRows;
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

function getAdminGalleryFilteredPrompts() {
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

    const filteredRows = (Array.isArray(allPrompts) ? allPrompts : []).filter((prompt) => {
        if (!prompt) {
            return false;
        }

        if (categoryValue) {
            const tags = Array.isArray(prompt.tags) ? prompt.tags : [];
            const hasMatchedTag = tags.some((tag) => String(tag || '').toLowerCase() === String(categoryValue).toLowerCase());
            if (!hasMatchedTag) {
                return false;
            }
        }

        if (!matchesAdminGalleryDateFilter(prompt, dateValue)) {
            return false;
        }

        if (!matchesAdminGalleryLanguageFilter(prompt, languageValue)) {
            return false;
        }

        if (!matchesAdminGalleryStatusFilter(prompt, statusValue)) {
            return false;
        }

        if (searchQuery && searchMatchedIds) {
            return searchMatchedIds.has(String(prompt.id || ''));
        }

        return true;
    });

    return sortAdminGalleryCards(sortValue, filteredRows);
}

function focusAdminGalleryPromptCard(promptId = '', options = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return false;
    }

    if (options.resetFilters !== false) {
        resetAdminGalleryManageFilters();
    }

    const fetchAndFocusMissingPrompt = () => {
        if (options.fetchIfMissing === false) {
            return false;
        }

        void fetchAdminPromptItem(normalizedPromptId, {
            site: getAdminPromptsReadSite()
        })
            .then((payload) => {
                const row = payload?.row;
                if (!row) {
                    return false;
                }
                allPrompts = [row];
                SEARCH_INDEX = null;
                HOT_TAGS_CACHE = null;
                syncAdminGalleryPaginationState({
                    page: 1,
                    pageSize: adminGalleryViewState.pageSize,
                    totalItems: 1,
                    totalPages: 1,
                    returnedItems: 1
                }, 1);
                applyAdminGalleryFilters({ resetPage: false });
                return focusAdminGalleryPromptCard(normalizedPromptId, {
                    resetFilters: false,
                    scroll: options.scroll !== false,
                    fetchIfMissing: false
                });
            })
            .catch((error) => {
                console.warn('[Gallery] Failed to fetch focused prompt card:', error);
            });
        return true;
    };

    const filteredRows = getAdminGalleryFilteredPrompts();
    const targetIndex = filteredRows.findIndex((prompt) => String(prompt?.id || '') === normalizedPromptId);
    if (targetIndex >= 0) {
        adminGalleryViewState.page = Math.floor(targetIndex / adminGalleryViewState.pageSize) + 1;
    } else {
        return fetchAndFocusMissingPrompt();
    }

    applyAdminGalleryFilters();

    const escapedPromptId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(normalizedPromptId)
        : normalizedPromptId.replace(/["\\]/g, '\\$&');
    const targetCard = document.querySelector(`#adminGrid .admin-card[data-id="${escapedPromptId}"]`);
    if (!targetCard) {
        return fetchAndFocusMissingPrompt();
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
    setPendingAdminGalleryFocusPromptId('');
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

function normalizeAdminGalleryPaginationPayload(pagination = {}, returnedItems = 0) {
    const fallbackTotal = Math.max(0, Number(returnedItems) || 0);
    const pageSize = normalizeAdminGalleryPage(pagination?.pageSize, adminGalleryViewState.pageSize || ADMIN_GALLERY_PAGE_SIZE);
    const totalItems = Math.max(0, Number(pagination?.totalItems) || fallbackTotal);
    const totalPages = Math.max(1, Number(pagination?.totalPages) || Math.ceil(totalItems / pageSize) || 1);
    const page = Math.min(
        Math.max(1, normalizeAdminGalleryPage(pagination?.page, adminGalleryViewState.page || 1)),
        totalPages
    );

    return {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
        returnedItems: Math.max(0, Number(pagination?.returnedItems) || returnedItems || 0)
    };
}

function syncAdminGalleryPaginationState(pagination = {}, returnedItems = 0) {
    const nextPagination = normalizeAdminGalleryPaginationPayload(pagination, returnedItems);
    adminGalleryViewState.page = nextPagination.page;
    adminGalleryViewState.pageSize = nextPagination.pageSize;
    adminGalleryViewState.pagination = nextPagination;
    return nextPagination;
}

async function renderLoadedAdminPromptRows(rows = [], { siteContext = getAdminPromptsReadSite(), resetPage = true, pagination = null, queryKey = '' } = {}) {
    const grid = document.getElementById('adminGrid');
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
    syncAdminGalleryPaginationState(pagination || {
        page: resetPage ? 1 : adminGalleryViewState.page,
        pageSize: adminGalleryViewState.pageSize,
        totalItems: safeRows.length,
        totalPages: Math.max(1, Math.ceil(safeRows.length / adminGalleryViewState.pageSize))
    }, safeRows.length);

    if (safeRows.length > 0) {
        renderGalleryOpsOverview();
        setAdminGallerySortFilterValue(document.getElementById('sortFilter')?.value || adminGalleryViewState.sortValue);
        updateBatchButtonStates();

        const searchInput = document.getElementById('adminSearchInput');
        const activeQuery = String(searchInput?.value || '').trim().toLowerCase();
        adminGalleryViewState.searchQuery = activeQuery;
        setupAdminSearch();
        adminGalleryViewState.searchMatchedIds = null;
        applyAdminGalleryFilters({ resetPage: false });

        const routePromptId = getPendingAdminGalleryFocusPromptId() || getAdminGalleryRouteState().promptId;
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
        renderAdminGalleryPagination();
    }

    setAdminGalleryLoadingChrome(false);
    markAdminGalleryPromptListLoaded(normalizedSite, queryKey);
    return true;
}

async function warmAdminGalleryHomepageFeatureStateInBackground(homepageWarmPromise, { site = getAdminPromptsReadSite(), requestId = adminGalleryLoadState.requestId } = {}) {
    try {
        await homepageWarmPromise;
        if (!isCurrentAdminGalleryLoadRequest(site, requestId)) {
            return false;
        }

        return refreshAdminGalleryCardsFromCache();
    } catch (error) {
        console.warn('[Gallery] Failed to warm homepage featured state:', error);
        return false;
    }
}

async function backfillAdminGalleryBilingualProjectionInBackground(rows = [], { site = getAdminPromptsReadSite(), requestId = adminGalleryLoadState.requestId } = {}) {
    const candidateIds = getPromptRowsMissingBilingualIds(rows);
    if (!candidateIds.length) {
        return false;
    }

    try {
        const verificationRows = await fetchPromptBilingualVerificationRows(candidateIds, {
            site,
            batchSize: ADMIN_GALLERY_BILINGUAL_BATCH_SIZE
        });
        if (!verificationRows.length || !isCurrentAdminGalleryLoadRequest(site, requestId)) {
            return false;
        }

        hydrateAdminGalleryPromptsLocally(verificationRows);
        return true;
    } catch (error) {
        console.warn('[Gallery] Failed to backfill bilingual prompt projection:', error);
        return false;
    }
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

function ensureAdminGalleryCardImageLoaded(card, { eager = false } = {}) {
    if (!card) {
        return false;
    }

    const image = card.querySelector('.admin-card-image');
    if (!(image instanceof HTMLImageElement)) {
        return false;
    }

    setAdminPromptCardImagePriority(image, { eager });

    if (image.dataset.loadRequested === 'true') {
        return true;
    }

    const primarySrc = String(image.dataset.primarySrc || '').trim();
    if (!primarySrc) {
        return false;
    }

    image.dataset.loadRequested = 'true';
    image.src = primarySrc;
    if (image.complete && image.naturalWidth > 0) {
        markAdminPromptCardImageReady(card, image);
    }
    return true;
}

function syncAdminGalleryVisibleCardImages() {
    const visibleCards = getAdminGalleryCards().filter((card) => (
        !card.classList.contains('admin-card--hidden-by-search')
        && !card.classList.contains('admin-card--hidden-by-pagination')
    ));

    visibleCards.forEach((card, index) => {
        ensureAdminGalleryCardImageLoaded(card, {
            eager: index < ADMIN_GALLERY_EAGER_IMAGE_COUNT
        });
    });
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
    syncAdminGalleryVisibleCardImages();
    return true;
}

function hydrateAdminGalleryPromptsLocally(rows = []) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
        return;
    }

    safeRows.forEach((row) => {
        upsertAdminGalleryPromptCacheRow(row);
    });

    SEARCH_INDEX = null;
    HOT_TAGS_CACHE = null;
    renderGalleryOpsOverview();
    updateBatchButtonStates();

    if (adminGalleryViewState.searchQuery) {
        setupAdminSearch();
        void filterBySearch(adminGalleryViewState.searchQuery);
        return;
    }

    applyAdminGalleryFilters();
}

function refreshAdminGalleryCardsFromCache() {
    if (!Array.isArray(allPrompts) || !allPrompts.length) {
        return false;
    }

    SEARCH_INDEX = null;
    HOT_TAGS_CACHE = null;
    renderGalleryOpsOverview();
    updateBatchButtonStates();

    if (adminGalleryViewState.searchQuery) {
        setupAdminSearch();
        void filterBySearch(adminGalleryViewState.searchQuery);
        return true;
    }

    applyAdminGalleryFilters();
    return true;
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
        showAdminStudioToast('未找到要加入首页的 Prompt', 'error');
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
        showAdminStudioToast(`加入首页失败: ${error.message || '未知错误'}`, 'error');
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

    const paginationState = normalizeAdminGalleryPaginationPayload(
        adminGalleryViewState.pagination,
        Array.isArray(allPrompts) ? allPrompts.length : 0
    );
    const totalItems = paginationState.totalItems;

    if (totalItems <= 0) {
        container.innerHTML = '';
        return;
    }

    const totalPages = paginationState.totalPages;
    const currentPage = paginationState.page;
    adminGalleryViewState.page = currentPage;

    syncAdminGalleryVisibleCardImages();

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
        adminGalleryViewState.filteredPromptIds = [];
        const hasActiveFilters = Boolean(
            adminGalleryViewState.searchQuery
            || document.getElementById('categoryFilter')?.value
            || document.getElementById('dateFilter')?.value
            || document.getElementById('languageFilter')?.value
            || document.getElementById('statusFilter')?.value
        );
        renderAdminStudioEmptyMessage(grid, hasActiveFilters ? '没有找到匹配的提示词' : 'No prompts yet. Create your first one!');
        if (pagination) {
            pagination.innerHTML = '';
        }
        return;
    }

    const searchQuery = String(adminGalleryViewState.searchQuery || '').trim().toLowerCase();
    const categoryValue = document.getElementById('categoryFilter')?.value || '';
    const dateValue = document.getElementById('dateFilter')?.value || '';
    const languageValue = document.getElementById('languageFilter')?.value || '';
    const statusValue = document.getElementById('statusFilter')?.value || '';
    renderGalleryOpsOverview();
    const pageRows = Array.isArray(allPrompts) ? allPrompts : [];
    adminGalleryViewState.filteredPromptIds = pageRows.map((prompt) => String(prompt?.id || ''));

    if (pageRows.length === 0) {
        const emptyText = searchQuery || categoryValue || dateValue || languageValue || statusValue
            ? '没有找到匹配的提示词'
            : 'No prompts yet. Create your first one!';
        grid.replaceChildren(createAdminStudioEmptyElement(emptyText, 'no-results-message'));
        if (pagination) {
            pagination.innerHTML = '';
        }
        return;
    }

    const fragment = document.createDocumentFragment();
    pageRows.forEach((prompt) => {
        const card = renderAdminCard(prompt);
        const visible = true;
        syncAdminSearchCardVisibility(card, visible);
        syncAdminGalleryPaginationCardVisibility(card, visible);
        fragment.appendChild(card);
    });
    grid.replaceChildren(fragment);
    renderAdminGalleryPagination();
}

function changeAdminGalleryPage(page) {
    adminGalleryViewState.page = normalizeAdminGalleryPage(page, adminGalleryViewState.page);
    return loadAdminPrompts({
        force: true,
        resetPage: false,
        preferFastRender: true,
        replaceExisting: true
    });
}

let adminAIServicePreferenceWarmPromise = null;

function warmAdminAIServicePreference(options = {}) {
    const force = options.force === true;

    if (adminAIServicePreferenceWarmPromise && !force) {
        return adminAIServicePreferenceWarmPromise;
    }

    adminAIServicePreferenceWarmPromise = Promise.resolve()
        .then(async () => {
            if (typeof window.warmSettingsDomainsInBackground === 'function') {
                await window.warmSettingsDomainsInBackground(['growth'], { force });
            }

            if (typeof window.applyAdminAIServicePreference === 'function') {
                const integrationsConfig = window.applyAdminAIServicePreference({
                    checkHealth: false,
                    refreshService: false
                });
                return integrationsConfig?.ai_service || window.ADMIN_AI_SERVICE || '';
            }

            const preferredService = typeof window.getCurrentAdminAIService === 'function'
                ? window.getCurrentAdminAIService()
                : (window.ADMIN_AI_SERVICE || 'gemini');
            const normalizedService = window.AdminAI?.normalizeService?.(preferredService)
                || String(preferredService || 'gemini').trim().toLowerCase()
                || 'gemini';

            window.ADMIN_AI_SERVICE = normalizedService;

            const setPreferredPromise = window.AdminAI?.setPreferredService?.(normalizedService);
            if (setPreferredPromise && typeof setPreferredPromise.then === 'function') {
                await setPreferredPromise;
            }

            return normalizedService;
        })
        .catch((error) => {
            console.warn('[AdminStudio] Failed to warm AI service preference:', error);
            return '';
        })
        .finally(() => {
            adminAIServicePreferenceWarmPromise = null;
        });

    return adminAIServicePreferenceWarmPromise;
}

function prefetchSettingsModule() {
    renderApiKeySelector();
    return warmAdminAIServicePreference();
}

let opsAlertsPrefetchPromise = null;

function prefetchOpsAlertsModule() {
    if (opsAlertsPrefetchPromise) {
        return opsAlertsPrefetchPromise;
    }

    const tasks = [
        window.loadOpsAlertSettings,
        window.loadOpsAlertHealth,
        window.loadRecoveryReadiness,
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
window.changeAdminGalleryPage = changeAdminGalleryPage;
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
    const action = String(
        normalizedContext.action
        || rawContext.action
        || payload.action
        || ''
    ).trim().toLowerCase();
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
        const opened = openAdminGalleryPromptContext(promptId, { ensureModule: false });
        if (opened && action === 'edit-prompt' && typeof window.editPrompt === 'function') {
            window.setTimeout(() => {
                window.editPrompt?.(promptId);
            }, 120);
        }
        return opened;
    }

    return false;
}

async function openAdminGalleryShellContext(context = {}, options = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    if (normalizedOptions.ensureModule !== false && !isGalleryModuleActive()) {
        const switched = window.AdminShell?.activateModule
            ? window.AdminShell.activateModule('gallery', { reason: 'gallery-shared-context', deferContext: true })
            : window.switchModule?.('gallery');
        if (switched === false) {
            return false;
        }
    }

    return handleAdminGalleryShellContext(normalizedContext, normalizedOptions);
}

window.openAdminGalleryShellContext = openAdminGalleryShellContext;

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

function countAdminPromptTextMatches(value, pattern) {
    return (String(value || '').match(pattern) || []).length;
}

function isAdminPromptMostlyCjkText(value) {
    const text = String(value || '');
    const cjkCount = countAdminPromptTextMatches(text, /[\u3400-\u9fff\uf900-\ufaff]/g);
    if (!cjkCount) return false;

    const latinCount = countAdminPromptTextMatches(text, /[A-Za-z]/g);
    if (!latinCount) return true;

    const languageSignalCount = cjkCount + latinCount;
    return cjkCount >= 4 && (cjkCount / languageSignalCount) >= 0.35;
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

function getAdminPromptCardById(promptId = '') {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
        return null;
    }
    return document.querySelector(`.admin-card[data-id="${CSS.escape(normalizedPromptId)}"]`);
}

function setAdminPromptEditFeedback(promptId = '', active = false) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
        return;
    }

    const escapedPromptId = CSS.escape(normalizedPromptId);
    const card = getAdminPromptCardById(normalizedPromptId);
    if (card) {
        card.classList.toggle('admin-card--editing', active);
        if (active) {
            card.setAttribute('aria-busy', 'true');
        } else {
            card.removeAttribute('aria-busy');
        }
    }

    document.querySelectorAll(`[data-prompt-edit-id="${escapedPromptId}"]`).forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        if (active) {
            button.dataset.originalHtml = button.dataset.originalHtml || button.innerHTML;
            button.dataset.originalTitle = button.dataset.originalTitle || button.title || '';
            button.disabled = true;
            button.classList.add('is-loading');
            button.setAttribute('aria-busy', 'true');
            button.title = '正在打开编辑';
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            return;
        }

        button.disabled = false;
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
            delete button.dataset.originalHtml;
        }
        if (Object.prototype.hasOwnProperty.call(button.dataset, 'originalTitle')) {
            button.title = button.dataset.originalTitle;
            delete button.dataset.originalTitle;
        }
    });
}

async function loadAdminPrompts(options = {}) {
    const site = normalizeAdminGallerySite(options?.site || getAdminPromptsReadSite());
    const force = options?.force === true;
    const allowCached = options?.allowCached === true;
    const preferFastRender = options?.preferFastRender === true || allowCached;
    const resetPage = options?.resetPage !== false;
    if (resetPage) {
        adminGalleryViewState.page = 1;
    }
    const listParams = getAdminGalleryListParams({
        ...options,
        site,
        page: adminGalleryViewState.page,
        pageSize: adminGalleryViewState.pageSize
    });
    const queryKey = getAdminGalleryListQueryKey(site, listParams);

    if (!force && allowCached && hasFreshAdminGalleryPromptList(site, queryKey)) {
        await renderLoadedAdminPromptRows(allPrompts, {
            siteContext: site,
            resetPage,
            pagination: adminGalleryViewState.pagination,
            queryKey
        });
        return {
            rows: allPrompts,
            siteContext: site,
            pagination: adminGalleryViewState.pagination,
            fromCache: true
        };
    }

    if (!force && allowCached && adminGalleryLoadState.promise && adminGalleryLoadState.site === site && adminGalleryLoadState.queryKey === queryKey) {
        renderAdminGalleryLoadingState({ preserveExisting: true });
        return adminGalleryLoadState.promise;
    }

    const requestId = adminGalleryLoadState.requestId + 1;
    adminGalleryLoadState.requestId = requestId;
    adminGalleryLoadState.site = site;
    adminGalleryLoadState.queryKey = queryKey;
    adminGalleryLoadState.loaded = false;

    const loadPromise = (async () => {
        try {
            renderAdminGalleryLoadingState({ preserveExisting: options?.replaceExisting !== true });
            let homepageWarmPromise = null;
            if (preferFastRender) {
                homepageWarmPromise = typeof window.HomepageAdmin?.ensureLoaded === 'function'
                    ? Promise.resolve()
                        .then(() => withTimeout(
                            window.HomepageAdmin.ensureLoaded(),
                            ADMIN_GALLERY_HOMEPAGE_WARM_TIMEOUT_MS,
                            'Homepage prompt state warm timed out'
                        ))
                        .catch((homepageError) => {
                            console.warn('[Gallery] Failed to warm homepage featured state:', homepageError);
                            return false;
                        })
                    : null;
            } else if (typeof window.HomepageAdmin?.ensureLoaded === 'function') {
                try {
                    await withTimeout(
                        window.HomepageAdmin.ensureLoaded(),
                        ADMIN_GALLERY_HOMEPAGE_WARM_TIMEOUT_MS,
                        'Homepage prompt state warm timed out'
                    );
                } catch (homepageError) {
                    console.warn('[Gallery] Failed to warm homepage featured state:', homepageError);
                }
            }

            const payload = await fetchAdminPromptList({
                ...listParams,
                hydrateBilingual: !preferFastRender
            });
            if (requestId !== adminGalleryLoadState.requestId) {
                return {
                    rows: allPrompts,
                    siteContext: site,
                    stale: true
                };
            }

            await renderLoadedAdminPromptRows(payload.rows || [], {
                siteContext: payload.siteContext || site,
                resetPage,
                pagination: payload.pagination,
                queryKey
            });

            if (preferFastRender) {
                if (homepageWarmPromise) {
                    void warmAdminGalleryHomepageFeatureStateInBackground(homepageWarmPromise, {
                        site: payload.siteContext || site,
                        requestId
                    });
                }
                void backfillAdminGalleryBilingualProjectionInBackground(payload.rows || [], {
                    site: payload.siteContext || site,
                    requestId
                });
            }
            return {
                ...payload,
                fromCache: false
            };
        } catch (err) {
            if (requestId === adminGalleryLoadState.requestId) {
                adminGalleryPrefetchState.loaded = false;
                markAdminGalleryPromptListStale(site);
            }
            setAdminGalleryLoadingChrome(false);
            console.error('Error loading prompts:', err);
            showAdminStudioToast(`Failed to load prompts: ${err.message || 'Unknown error'}`, 'error');
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

    const media = document.createElement('div');
    media.className = 'admin-card-media';

    const image = document.createElement('img');
    image.className = 'admin-card-image';
    image.alt = prompt.title || 'Prompt cover';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', handleAdminPromptCardImageLoad);
    image.addEventListener('error', handleAdminPromptCardImageError);

    const promptImageAssets = normalizePromptImageAssetsFromRecord(prompt);
    const rawImageUrl = promptImageAssets[0] || (Array.isArray(prompt.images) ? prompt.images[0] : '');
    const imageUrl = getOptimizedPromptCardImageUrl(rawImageUrl);
    const imageCandidates = buildAdminPromptCardImageCandidates(rawImageUrl, imageUrl);
    if (imageUrl) {
        image.dataset.primarySrc = imageCandidates.primarySrc;
        image.dataset.originalSrc = imageCandidates.originalSrc;
        image.dataset.transformFallbackSrc = imageCandidates.transformFallbackSrc;
        image.dataset.fallbackStage = '';
        image.dataset.loadRequested = 'false';
    } else {
        image.removeAttribute('src');
        image.removeAttribute('data-primary-src');
        image.removeAttribute('data-original-src');
        image.removeAttribute('data-transform-fallback-src');
        image.removeAttribute('data-fallback-stage');
        image.removeAttribute('data-load-requested');
    }
    media.appendChild(image);
    media.appendChild(checkbox);

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

    const opsNote = document.createElement('div');
    opsNote.className = 'admin-card-ops-note';
    if (opsSummary) {
        opsNote.textContent = opsSummary;
    } else {
        opsNote.classList.add('admin-card-ops-note--placeholder');
        opsNote.innerHTML = '&nbsp;';
    }
    content.appendChild(opsNote);

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
    hoverEdit.setAttribute('data-prompt-edit-id', String(prompt.id || ''));
    hoverEdit.innerHTML = '<i class="fas fa-edit"></i>';
    hoverEdit.addEventListener('click', (event) => {
        event.stopPropagation();
        void editPrompt(prompt.id);
    });
    hoverLeft.appendChild(hoverEdit);
    media.appendChild(hoverLeft);

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
    media.appendChild(hoverRight);

    const actions = document.createElement('div');
    actions.className = 'admin-card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'admin-action-btn';
    editBtn.type = 'button';
    editBtn.setAttribute('data-prompt-edit-id', String(prompt.id || ''));
    editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
    editBtn.addEventListener('click', () => {
        void editPrompt(prompt.id);
    });

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
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
        showAdminStudioToast('请先选择要编辑的提示词', 'error');
        return;
    }

    setAdminPromptEditFeedback(normalizedId, true);

    try {
        const payload = await fetchAdminPromptItem(normalizedId);
        const data = payload.row;
        const promptOpsData = getPromptAdminOpsData(data);
        currentEditingPromptAiTags = clonePromptAiTags(data.ai_tags || {});

        // Switch to create view
        switchView('create');

        // Set mode to edit
        currentMode = 'edit';
        editingId = normalizedId;
        currentEditingPromptImageAssets = normalizePromptImageAssetsFromRecord(data);
        currentEditingPromptImageUrls = dedupePromptImageUrls(
            currentEditingPromptImageAssets.map(getPromptImageAssetOriginalUrl)
        );

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
            source_url: data.source_url || '',
            source_author_name: data.source_author_name || '',
            source_author_handle: data.source_author_handle || '',
            opsStatus: promptOpsData.status,
            opsNote: promptOpsData.note,
            objects: data.ai_tags?.objects,
            scenes: data.ai_tags?.scenes,
            styles: data.ai_tags?.styles,
            mood: data.ai_tags?.mood,
            useCase: data.ai_tags?.useCase,
            commercial: data.ai_tags?.commercial,
            difficulty: data.ai_tags?.difficulty,
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
        syncGallerySaveButtonState('edit');

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
            renderPreviewGridItems(
                currentEditingPromptImageAssets.map((asset) => ({ url: getPromptImageAssetOriginalUrl(asset), asset })),
                { removable: false, croppable: true }
            );

            await hydrateEditingImagesForAnalysis();
        }

        // Scroll to form
        setTimeout(() => {
            promptForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

    } catch (err) {
        console.error('Error loading prompt for edit:', err);
        showAdminStudioToast('Failed to load prompt', 'error');
    } finally {
        setAdminPromptEditFeedback(normalizedId, false);
    }
}

window.editPrompt = editPrompt;

function buildGallerySaveButtonMarkup(label, iconClass = 'fas fa-save') {
    return `<i class="${iconClass}"></i><span>${label}</span>`;
}

function syncGalleryEditModePanels(mode = currentMode) {
    void mode;
    const aiTagsGroup = document.getElementById('promptAiTagsGroup');
    setAdminStudioVisibility(aiTagsGroup, false);
}

function syncGallerySaveButtonState(mode = currentMode) {
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) {
        return;
    }

    const normalizedMode = mode === 'edit' ? 'edit' : 'create';
    const btnText = saveBtn.querySelector('.btn-text');
    const loadingLabel = saveBtn.querySelector('.btn-loading-label');

    saveBtn.dataset.mode = normalizedMode;
    saveBtn.setAttribute('aria-label', normalizedMode === 'edit' ? 'Update Prompt' : 'Save to Gallery');
    syncGalleryEditModePanels(normalizedMode);

    if (btnText) {
        btnText.innerHTML = buildGallerySaveButtonMarkup(
            normalizedMode === 'edit' ? 'Update Prompt' : 'Save to Gallery'
        );
    }

    if (loadingLabel) {
        loadingLabel.textContent = normalizedMode === 'edit' ? 'Updating' : 'Saving';
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
    syncGallerySaveButtonState('create');

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
                if (getPendingAdminGalleryFocusPromptId() === String(id)) {
                    setPendingAdminGalleryFocusPromptId('');
                }
                applyAdminGalleryFilters();
                updateBatchButtonStates();
            }, 300);
        }

        showAdminStudioToast('Prompt deleted successfully!', 'success');
    } catch (err) {
        console.error('Delete operation failed:', err);
        showAdminStudioToast(`Delete failed: ${err.message || 'Unknown error'}`, 'error');
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
            window.GEMINI_API_DECRYPT_ERROR = payload.decryptErrorMessage || '';
        }

        if (payload.configured) {
            updateStatus(`${currentServiceLabel} Ready`, 'ready');
        } else {
            updateStatus(`${currentServiceLabel} Missing`, 'error');
        }
    } catch (err) {
        console.warn('Failed to verify AI proxy:', err);
        updateStatus(getAIHealthFailureStatusText(currentServiceLabel, err), 'error');
    } finally {
        renderApiKeySelector();
        updateAnalyzeButton();
    }
}

function getAIHealthFailureStatusText(serviceLabel = 'AI Proxy', error = null) {
    const status = Number(error?.status || error?.statusCode || 0);

    if (status === 401) {
        return `${serviceLabel} Auth Required`;
    }

    if (status === 403) {
        return `${serviceLabel} Forbidden`;
    }

    return `${serviceLabel} Unavailable`;
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
    const decryptErrorMessage = String(window.GEMINI_API_DECRYPT_ERROR || '').trim();

    if (decryptErrorMessage) {
        return {
            source: 'missing',
            title: '需要重新录入',
            preview: decryptErrorMessage,
            badge: '需重录',
            statusText: decryptErrorMessage
        };
    }

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
    apiFormat: 'responses',
    decryptErrorMessage: ''
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
        apiFormat: normalizeCodexApiFormat(current.apiFormat),
        decryptErrorMessage: String(current.decryptErrorMessage || '').trim()
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

    if (Object.prototype.hasOwnProperty.call(payload, 'decryptErrorMessage')) {
        next.decryptErrorMessage = String(payload.decryptErrorMessage || '').trim();
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
    const decryptErrorMessage = String(config.decryptErrorMessage || '').trim();

    if (decryptErrorMessage) {
        return {
            source: 'missing',
            title: '需要重新录入',
            preview: decryptErrorMessage,
            badge: '需重录',
            statusText: decryptErrorMessage
        };
    }

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

const adminAiImageState = {
    loaded: false,
    loading: false,
    agents: [],
    pricing: [],
    apiBaseUrls: [],
    guardrails: null,
    storagePolicy: null,
    storageUsage: null,
    warnings: {},
    runtime: null,
    modelConfig: null,
    selectedModelProviderId: 'default',
    modelProviderPanelState: Object.create(null),
    modelProviderDraft: null,
    modelProbes: Object.create(null),
    modelProbe: null,
    selectedPricingId: '',
    lastRun: null
};

const DEFAULT_AI_IMAGE_MODEL_CONFIG = Object.freeze({
    configured: false,
    source: 'missing',
    providerId: 'default',
    label: '新上游',
    vendor: 'openai',
    vendorLabel: '',
    protocol: 'openai-compatible',
    modelGroup: 'both',
    baseUrl: '',
    model: '',
    models: [],
    imageModels: [],
    chatModels: [],
    videoModels: [],
    visionModels: [],
    detectedImageModels: [],
    detectedChatModels: [],
    detectedVideoModels: [],
    detectedUnknownModels: [],
    providers: [],
    decryptErrorMessage: ''
});

const DEFAULT_AI_IMAGE_GUARDRAILS = Object.freeze({
    submit: Object.freeze({
        global: Object.freeze({ limit: 180, windowMs: 60000 }),
        ip: Object.freeze({ limit: 30, windowMs: 60000 }),
        user: Object.freeze({ limit: 12, windowMs: 60000 }),
        heavyUser: Object.freeze({ limit: 4, windowMs: 60000 }),
        model: Object.freeze({ limit: 6, windowMs: 60000 })
    }),
    upload: Object.freeze({
        global: Object.freeze({ limit: 420, windowMs: 60000 }),
        ip: Object.freeze({ limit: 36, windowMs: 60000 }),
        user: Object.freeze({ limit: 18, windowMs: 60000 })
    }),
    download: Object.freeze({
        global: Object.freeze({ limit: 1200, windowMs: 60000 }),
        ip: Object.freeze({ limit: 180, windowMs: 60000 }),
        user: Object.freeze({ limit: 120, windowMs: 60000 }),
        resource: Object.freeze({ limit: 24, windowMs: 60000 })
    }),
    tasks: Object.freeze({
        running: 2,
        queued: 5,
        active: 6
    })
});

const DEFAULT_AI_IMAGE_STORAGE_POLICY = Object.freeze({
    previewRetentionDays: 180,
    originalRetentionDays: 365,
    failedRetentionDays: 30,
    warnStorageGb: 8,
    stopStorageGb: 10,
    lifecycleEnabled: false
});

const AI_IMAGE_PRICING_MODE_LABELS = Object.freeze({
    text: '图片生成',
    video: '视频生成',
    chat: '文本对话'
});

const AI_IMAGE_PRICING_MODE_ALIASES = Object.freeze({
    image: 'text',
    agent: 'text',
    reverse: 'chat'
});

const AI_IMAGE_PRICING_STRATEGY_LABELS = Object.freeze({
    per_request: '按次 / 张',
    token_sub2api: 'Sub2API 实际扣费',
    fixed_points: '固定积分兜底'
});

const AI_IMAGE_PRICING_DEFAULT_ESTIMATES = Object.freeze({
    text: Object.freeze({ input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, image_output_tokens: 0 }),
    image: Object.freeze({ input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, image_output_tokens: 0 }),
    video: Object.freeze({ input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, image_output_tokens: 0 }),
    reverse: Object.freeze({ input_tokens: 1200, output_tokens: 450, cache_write_tokens: 0, cache_read_tokens: 0, image_output_tokens: 0 }),
    chat: Object.freeze({ input_tokens: 1800, output_tokens: 700, cache_write_tokens: 0, cache_read_tokens: 0, image_output_tokens: 0 }),
    agent: Object.freeze({ input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, image_output_tokens: 0 })
});

function normalizeAdminAiImageSite() {
    return 'all';
}

function normalizeAiImageModelBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
        const url = new URL(raw);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/\/+$/, '') || '/v1';
        if (url.pathname === '/') {
            url.pathname = '/v1';
        }
        if (!/\/v\d+(?:\/.*)?$/i.test(url.pathname)) {
            url.pathname = `${url.pathname}/v1`.replace(/\/{2,}/g, '/');
        }
        return url.toString().replace(/\/+$/, '');
    } catch (_) {
        return raw.replace(/\/+$/, '');
    }
}

function normalizeAiImageModelName(value) {
    const model = String(value || '').trim();
    return model && model !== 'gpt-image' && model !== 'gpt-image-api'
        ? model
        : ADMIN_AI_IMAGE_DEFAULT_MODEL;
}

function normalizeAiImageOptionalModelName(value) {
    const model = String(value || '').trim();
    if (!model || model === 'gpt-image' || model === 'gpt-image-api') return '';
    return model;
}

function normalizeAiImageProviderId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'default';
}

function normalizeAiImageModelsList(value, fallbackModel = '') {
    const rawItems = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\n]/);
    const models = [];
    const seen = new Set();
    rawItems.forEach((item) => {
        const rawModel = String(item || '').trim();
        if (!rawModel) return;
        const model = normalizeAiImageModelName(rawModel);
        const key = model.toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        models.push(model);
    });
    const fallback = String(fallbackModel || '').trim() ? normalizeAiImageModelName(fallbackModel) : '';
    if (fallback && !seen.has(fallback.toLowerCase())) {
        models.unshift(fallback);
    }
    return models;
}

function mergeAiImageModelsList(existing = '', model = '') {
    return normalizeAiImageModelsList([
        ...normalizeAiImageModelsList(existing, ''),
        model
    ], '');
}

function setAiImageModelsInputValue(input, models = []) {
    if (!input) return;
    input.value = normalizeAiImageModelsList(models, '').join(', ');
}

function getAiImageModelCountLabel(count = 0, label = '模型') {
    const total = Number(count || 0);
    return total > 0 ? `${label} ${total} 个` : `${label} 0 个`;
}

function normalizeAiImageModelVendorLabel(value = '', fallback = '') {
    return String(value || fallback || '').trim().slice(0, 80);
}

function isAiImageCustomVendor(value = '') {
    return normalizeAiImageModelVendor(value, 'openai') === 'custom';
}

function getAiImageVendorLabel(value = '', customLabel = '') {
    const normalized = normalizeAiImageModelVendor(value, 'openai');
    const normalizedCustomLabel = normalizeAiImageModelVendorLabel(customLabel);
    if (normalized === 'custom' && normalizedCustomLabel) {
        return normalizedCustomLabel;
    }
    const labels = {
        openai: 'ChatGPT',
        gemini: 'Gemini',
        anthropic: 'Claude',
        flux: 'FLUX',
        sub2api: 'Sub2API',
        custom: '自定义'
    };
    return labels[normalized] || normalized;
}

function mergeAiImageModelCandidates(...lists) {
    return normalizeAiImageModelsList(lists.flatMap((list) => normalizeAiImageModelsList(list, '')), '');
}

function removeAiImageModelCandidate(list = [], model = '') {
    const normalizedModel = normalizeAiImageOptionalModelName(model).toLowerCase();
    if (!normalizedModel) return normalizeAiImageModelsList(list, '');
    return normalizeAiImageModelsList(list, '').filter((item) => item.toLowerCase() !== normalizedModel);
}

function createEmptyAiImageModelProviderDraft() {
    const providers = getAiImageModelProviders(getAiImageModelConfig());
    const existingIds = new Set(providers.map((item) => item.providerId));
    let index = providers.length + 1;
    let providerId = normalizeAiImageProviderId(`provider-${index}`);
    while (existingIds.has(providerId)) {
        index += 1;
        providerId = normalizeAiImageProviderId(`provider-${index}`);
    }
    return normalizeAiImageModelProvider({
        ...DEFAULT_AI_IMAGE_MODEL_CONFIG,
        providerId,
        label: '新上游',
        configured: false,
        source: 'missing',
        modelGroup: 'both',
        model: '',
        models: [],
        imageModels: [],
        chatModels: [],
        videoModels: [],
        visionModels: [],
        detectedImageModels: [],
        detectedChatModels: [],
        detectedVideoModels: [],
        detectedUnknownModels: []
    });
}

function getAiImageEditingModelProvider(config = getAiImageModelConfig()) {
    return adminAiImageState.modelProviderDraft
        ? normalizeAiImageModelProvider(adminAiImageState.modelProviderDraft)
        : getSelectedAiImageModelProvider(config);
}

function setAiImageEditingModelProviderDraft(updates = {}) {
    const base = getAiImageEditingModelProvider(getAiImageModelConfig());
    adminAiImageState.modelProviderDraft = normalizeAiImageModelProvider({
        ...base,
        ...(updates && typeof updates === 'object' ? updates : {})
    });
    return adminAiImageState.modelProviderDraft;
}

function clearAiImageEditingModelProviderDraft() {
    adminAiImageState.modelProviderDraft = null;
}

function setAiImageHiddenModelInputValues(provider = {}) {
    setAiImageModelsInputValue(document.getElementById('aiImageModelAliasesInput'), provider.imageModels || provider.image_models || provider.models || []);
    setAiImageModelsInputValue(document.getElementById('aiImageChatModelAliasesInput'), provider.chatModels || provider.chat_models || []);
    setAiImageModelsInputValue(document.getElementById('aiImageVideoModelAliasesInput'), provider.videoModels || provider.video_models || []);
    setAiImageModelsInputValue(document.getElementById('aiImageDetectedImageModelsInput'), provider.detectedImageModels || provider.detected_image_models || provider.imageModels || []);
    setAiImageModelsInputValue(document.getElementById('aiImageDetectedChatModelsInput'), provider.detectedChatModels || provider.detected_chat_models || provider.chatModels || []);
    setAiImageModelsInputValue(document.getElementById('aiImageDetectedVideoModelsInput'), provider.detectedVideoModels || provider.detected_video_models || provider.videoModels || []);
    setAiImageModelsInputValue(document.getElementById('aiImageDetectedUnknownModelsInput'), provider.detectedUnknownModels || provider.detected_unknown_models || []);
    setAiImageModelsInputValue(document.getElementById('aiImageVisionModelsInput'), provider.visionModels || provider.vision_models || provider.chatVisionModels || provider.chat_vision_models || []);
    const modelInput = document.getElementById('aiImageModelNameInput');
    if (modelInput) {
        modelInput.value = provider.model || provider.imageModels?.[0] || provider.chatModels?.[0] || provider.videoModels?.[0] || '';
    }
    const modelGroupInput = document.getElementById('aiImageModelGroupInput');
    if (modelGroupInput) {
        modelGroupInput.value = inferAiImageModelGroupFromLists(provider.imageModels || [], provider.chatModels || [], provider.videoModels || []);
    }
}

function renderAiImageVisibleModelPill(model = '', group = 'image', selectedModels = [], providerId = '') {
    const label = String(model || '').trim();
    if (!label) return '';
    const selectedSet = new Set(normalizeAiImageModelsList(selectedModels, '').map((item) => item.toLowerCase()));
    const isSelected = selectedSet.has(label.toLowerCase());
    return `
        <button class="ai-image-admin-visible-model-pill ${isSelected ? 'is-selected' : ''}" type="button"
            data-admin-action="settings-toggle-ai-image-visible-model"
            data-model="${escapeHtml(label)}"
            data-model-group="${escapeHtml(group)}"
            data-provider-id="${escapeHtml(providerId || '')}"
            aria-pressed="${isSelected ? 'true' : 'false'}">
            <i class="fas ${isSelected ? 'fa-check' : 'fa-plus'}"></i>
            <span>${escapeHtml(label)}</span>
        </button>
    `;
}

function renderAiImageUnknownModelClassifier(model = '', providerId = '') {
    const label = String(model || '').trim();
    if (!label) return '';
    return `
        <span class="ai-image-admin-visible-model-classifier">
            <span class="ai-image-admin-visible-model-classifier__name">${escapeHtml(label)}</span>
            <button type="button"
                data-admin-action="settings-classify-ai-image-unknown-model"
                data-model="${escapeHtml(label)}"
                data-model-group="chat"
                data-provider-id="${escapeHtml(providerId || '')}">
                设为文本
            </button>
            <button type="button"
                data-admin-action="settings-classify-ai-image-unknown-model"
                data-model="${escapeHtml(label)}"
                data-model-group="image"
                data-provider-id="${escapeHtml(providerId || '')}">
                设为生图
            </button>
            <button type="button"
                data-admin-action="settings-classify-ai-image-unknown-model"
                data-model="${escapeHtml(label)}"
                data-model-group="video"
                data-provider-id="${escapeHtml(providerId || '')}">
                设为视频
            </button>
        </span>
    `;
}

function renderAiImageVisibleModelSection({
    title = '',
    description = '',
    emptyText = '',
    group = 'image',
    detectedModels = [],
    selectedModels = [],
    providerId = ''
} = {}) {
    const detected = mergeAiImageModelCandidates(detectedModels, selectedModels);
    const selectedCount = normalizeAiImageModelsList(selectedModels, '').length;
    const pills = detected.map((model) => renderAiImageVisibleModelPill(model, group, selectedModels, providerId)).join('');
    return `
        <div class="ai-image-admin-visible-model-section" data-model-picker-section="${escapeHtml(group)}">
            <div class="ai-image-admin-visible-model-section__header">
                <div>
                    <strong>${escapeHtml(title)}</strong>
                    <span>${escapeHtml(description)}</span>
                </div>
                <em>${escapeHtml(getAiImageModelCountLabel(selectedCount, '已选'))}</em>
            </div>
            <div class="ai-image-admin-visible-model-pills">
                ${pills || `<span class="ai-image-admin-visible-model-empty">${escapeHtml(emptyText)}</span>`}
            </div>
        </div>
    `;
}

function renderAiImageProviderVisibleModelSection(provider = {}) {
    const imageModels = normalizeAiImageModelsList(provider.imageModels || provider.image_models || provider.models, '');
    const chatModels = normalizeAiImageModelsList(provider.chatModels || provider.chat_models, '');
    const videoModels = normalizeAiImageModelsList(provider.videoModels || provider.video_models, '');
    const detectedImageModels = mergeAiImageModelCandidates(provider.detectedImageModels, provider.detected_image_models, imageModels);
    const detectedChatModels = mergeAiImageModelCandidates(provider.detectedChatModels, provider.detected_chat_models, chatModels);
    const detectedVideoModels = mergeAiImageModelCandidates(provider.detectedVideoModels, provider.detected_video_models, videoModels);
    const detectedUnknownModels = mergeAiImageModelCandidates(provider.detectedUnknownModels, provider.detected_unknown_models)
        .filter((model) => ![...imageModels, ...chatModels, ...videoModels].some((selected) => selected.toLowerCase() === model.toLowerCase()));
    const visibleModelGroups = [
        {
            title: '文本对话',
            description: '只进入文本对话输入框的模型下拉菜单',
            emptyText: '未检测到文本对话模型；保存后前台文本模型下拉留空。',
            group: 'chat',
            detectedModels: detectedChatModels,
            selectedModels: chatModels
        },
        {
            title: '生成图片',
            description: '只进入生成图片输入框的模型下拉菜单',
            emptyText: '未检测到图片生成模型；保存后前台生图模型下拉留空。',
            group: 'image',
            detectedModels: detectedImageModels,
            selectedModels: imageModels
        },
        {
            title: '生成视频',
            description: '只进入生成视频输入框的模型下拉菜单',
            emptyText: '未检测到视频生成模型；保存后前台视频模型下拉留空。',
            group: 'video',
            detectedModels: detectedVideoModels,
            selectedModels: videoModels
        }
    ].filter((group) => mergeAiImageModelCandidates(group.detectedModels, group.selectedModels).length);
    return `
        <div class="ai-image-admin-visible-models__header ai-image-admin-visible-models__header--compact">
            <strong>前台可见模型</strong>
        </div>
        ${visibleModelGroups.length ? `
            <div class="ai-image-admin-visible-models__grid">
                ${visibleModelGroups.map((group) => renderAiImageVisibleModelSection({
                    ...group,
                    providerId: provider.providerId || ''
                })).join('')}
            </div>
        ` : `
            <div class="ai-image-admin-visible-model-empty ai-image-admin-visible-model-empty--wide">
                检测上游支持模型后，可在这里勾选前台可见的文本 / 图片 / 视频模型。
            </div>
        `}
        ${detectedUnknownModels.length ? `
            <div class="ai-image-admin-visible-model-section ai-image-admin-visible-model-section--unknown">
                <div class="ai-image-admin-visible-model-section__header">
                    <div>
                        <strong>未分类模型</strong>
                        <span>系统无法可靠判断用途，默认不进入前台；确认能力后可手动设为文本、生图或视频。</span>
                    </div>
                    <em>${escapeHtml(`${detectedUnknownModels.length} 个`)}</em>
                </div>
                <div class="ai-image-admin-visible-model-pills">
                    ${detectedUnknownModels.map((model) => renderAiImageUnknownModelClassifier(model, provider.providerId || '')).join('')}
                </div>
            </div>
        ` : ''}
    `;
}

function inferAiImageModelGroupFromLists(imageModels = [], chatModels = [], videoModels = []) {
    const hasImageModels = normalizeAiImageModelsList(imageModels, '').length > 0;
    const hasChatModels = normalizeAiImageModelsList(chatModels, '').length > 0;
    const hasVideoModels = normalizeAiImageModelsList(videoModels, '').length > 0;
    if (hasVideoModels && !hasImageModels && !hasChatModels) return 'video';
    if (hasImageModels && hasChatModels) return 'both';
    if (hasChatModels) return 'chat';
    return 'image';
}

function getAiImageProbeModeLabel(mode = '') {
    const normalized = String(mode || '').trim().toLowerCase();
    if (normalized === 'image') return '续作编辑';
    if (normalized === 'chat') return '对话';
    if (normalized === 'vision') return '视觉反推';
    if (normalized === 'video') return '生成视频';
    return '文生图';
}

function getAiImageProbeDiscoveryGroups(discovery = {}, provider = {}) {
    if (!discovery || typeof discovery !== 'object' || discovery.ok === false) {
        return [];
    }
    const selectedModelSet = new Set([
        ...normalizeAiImageModelsList(provider.imageModels || provider.image_models || provider.models, ''),
        ...normalizeAiImageModelsList(provider.chatModels || provider.chat_models, ''),
        ...normalizeAiImageModelsList(provider.videoModels || provider.video_models, '')
    ].map((model) => model.toLowerCase()));
    const imageModels = normalizeAiImageModelsList(discovery.imageModels || discovery.image_models, '').slice(0, 8);
    const chatModels = normalizeAiImageModelsList(discovery.chatModels || discovery.chat_models, '').slice(0, 8);
    const videoModels = normalizeAiImageModelsList(discovery.videoModels || discovery.video_models, '').slice(0, 8);
    const unknownModels = normalizeAiImageModelsList(discovery.unknownModels || discovery.unknown_models, '')
        .filter((model) => !selectedModelSet.has(model.toLowerCase()))
        .slice(0, 6);
    return [
        imageModels.length ? { group: 'image', label: '生图候选', models: imageModels } : null,
        chatModels.length ? { group: 'chat', label: '对话候选', models: chatModels } : null,
        videoModels.length ? { group: 'video', label: '视频候选', models: videoModels } : null,
        unknownModels.length ? { group: 'unknown', label: '未分类', models: unknownModels } : null
    ].filter(Boolean);
}

function getAiImageProbeUpstreamText(upstream = {}) {
    if (!upstream || typeof upstream !== 'object') return '';
    return [
        upstream.channelName ? `通道：${upstream.channelName}` : '',
        upstream.channelId ? `通道 ID：${upstream.channelId}` : '',
        upstream.upstreamProvider ? `上游：${upstream.upstreamProvider}` : '',
        upstream.upstreamModel ? `实际模型：${upstream.upstreamModel}` : '',
        upstream.requestId ? `请求 ID：${upstream.requestId}` : ''
    ].filter(Boolean).join(' · ');
}

function setAiImageModelProbe(probe = null) {
    if (!probe || typeof probe !== 'object') {
        adminAiImageState.modelProbe = null;
        return null;
    }

    if (!adminAiImageState.modelProbes || typeof adminAiImageState.modelProbes !== 'object') {
        adminAiImageState.modelProbes = Object.create(null);
    }

    const providerId = normalizeAiImageProviderId(probe.providerId || probe.provider_id || '');
    const normalizedProbe = {
        ...probe,
        ...(providerId ? { providerId, provider_id: providerId } : {})
    };
    adminAiImageState.modelProbe = normalizedProbe;
    if (providerId) {
        adminAiImageState.modelProbes[providerId] = normalizedProbe;
        adminAiImageState.modelProviderPanelState[providerId] = true;
    }
    return normalizedProbe;
}

function getAiImageProviderProbe(providerId = '') {
    const normalizedProviderId = normalizeAiImageProviderId(providerId);
    if (!normalizedProviderId) return null;
    const scopedProbe = adminAiImageState.modelProbes?.[normalizedProviderId] || null;
    if (scopedProbe) return scopedProbe;
    const lastProbeProviderId = normalizeAiImageProviderId(adminAiImageState.modelProbe?.providerId || adminAiImageState.modelProbe?.provider_id || '');
    return lastProbeProviderId === normalizedProviderId ? adminAiImageState.modelProbe : null;
}

function getAiImageProviderProbeStatus(probe = null, provider = {}) {
    const providerLabel = provider.label || provider.providerId || '当前上游';
    if (!probe) {
        return {
            tone: '',
            text: `尚未检测：可在「${providerLabel}」内运行模型自检或检测上游支持模型`
        };
    }

    const isDiscoveryProbe = probe.discoveryOnly === true;
    if (probe.pending) {
        return {
            tone: 'loading',
            text: isDiscoveryProbe
                ? `正在检测「${probe.providerLabel || providerLabel}」上游支持模型...`
                : `正在运行「${probe.providerLabel || providerLabel}」模型可用性自检...`
        };
    }

    if (probe.ok) {
        if (isDiscoveryProbe) {
            return {
                tone: 'ready',
                text: `检测完成：${Number(probe.imageModels?.length || 0)} 个生图模型，${Number(probe.chatModels?.length || 0)} 个对话模型，${Number(probe.videoModels?.length || 0)} 个视频模型`
            };
        }
        if (Array.isArray(probe.checks) && probe.checks.length) {
            return {
                tone: 'ready',
                text: `模型自检通过：${probe.passed || probe.checks.length}/${probe.total || probe.checks.length} 项可用`
            };
        }
        const seconds = Number(probe.latencyMs || 0)
            ? `${(Number(probe.latencyMs) / 1000).toFixed(1)} 秒`
            : '已返回';
        return {
            tone: 'ready',
            text: `模型自检通过：${probe.model || provider.model || providerLabel} · ${probe.resultType || '结果'} · ${seconds}`
        };
    }

    if (isDiscoveryProbe) {
        return {
            tone: 'error',
            text: `检测失败：${probe.message || '未发现可用模型'}`
        };
    }
    if (Array.isArray(probe.checks) && probe.checks.length) {
        return {
            tone: 'error',
            text: `模型自检完成：${probe.passed || 0}/${probe.total || probe.checks.length} 项通过，${probe.failed || 0} 项失败`
        };
    }
    return {
        tone: 'error',
        text: `模型自检失败：${probe.message || '上游模型不可用'}`
    };
}

function renderAiImageDiscoveredModelButton(model = '', group = 'unknown', providerId = '') {
    const label = String(model || '').trim();
    if (!label) return '';
    const normalizedGroup = String(group || '').trim().toLowerCase();
    if (normalizedGroup === 'unknown') {
        return renderAiImageUnknownModelClassifier(label, providerId);
    }
    const safeGroup = ['chat', 'image', 'video'].includes(normalizedGroup) ? normalizedGroup : 'image';
    return `
        <button class="ai-image-admin-model-chip" type="button"
            data-admin-action="settings-apply-ai-image-discovered-model"
            data-model="${escapeHtml(label)}"
            data-model-group="${escapeHtml(safeGroup)}"
            data-provider-id="${escapeHtml(providerId || '')}">
            ${escapeHtml(label)}
        </button>
    `;
}

function renderAiImageProbeGridHtml(probe = null, provider = {}) {
    if (!probe || probe.pending) return '';
    const isDiscoveryProbe = probe.discoveryOnly === true;
    const checks = Array.isArray(probe.checks) ? probe.checks : [];
    const discovery = probe.discovery && typeof probe.discovery === 'object' ? probe.discovery : null;
    const modelPresence = probe.modelPresence && typeof probe.modelPresence === 'object' ? probe.modelPresence : null;
    const discoveryGroups = getAiImageProbeDiscoveryGroups(discovery, provider);
    const discoveryHtml = discovery ? `
        <div class="ai-image-admin-probe-discovery ${discovery.ok ? 'is-ok' : 'is-error'}">
            <strong>${escapeHtml(isDiscoveryProbe && probe.ok
                ? `已更新上游候选模型：生图 ${Number(probe.imageModels?.length || 0)} 个，对话 ${Number(probe.chatModels?.length || 0)} 个，视频 ${Number(probe.videoModels?.length || 0)} 个`
                : (discovery.ok ? `发现上游模型 ${Number(discovery.total || discovery.models?.length || 0)} 个` : '上游模型发现失败'))}</strong>
            <span>${escapeHtml(discovery.ok ? `${discovery.endpoint || 'models'} · ${(Number(discovery.latencyMs || 0) / 1000).toFixed(1)}s` : `${discovery.code || 'model_discovery_failed'} · ${discovery.message || '无法读取 /models'}`)}</span>
            ${getAiImageProbeUpstreamText(discovery.upstream) ? `<em>${escapeHtml(getAiImageProbeUpstreamText(discovery.upstream))}</em>` : ''}
            ${modelPresence?.chat?.missing?.length ? `<em>对话模型未在列表中：${escapeHtml(modelPresence.chat.missing.join(' / '))}</em>` : ''}
            ${modelPresence?.image?.missing?.length ? `<em>生图模型未在列表中：${escapeHtml(modelPresence.image.missing.join(' / '))}</em>` : ''}
            ${modelPresence?.video?.missing?.length ? `<em>视频模型未在列表中：${escapeHtml(modelPresence.video.missing.join(' / '))}</em>` : ''}
            ${discoveryGroups.length ? `
                <div class="ai-image-admin-model-chip-groups">
                    ${discoveryGroups.map((group) => `
                        <div class="ai-image-admin-model-chip-group">
                            <span>${escapeHtml(group.label)}</span>
                            <div>${group.models.map((model) => renderAiImageDiscoveredModelButton(model, group.group, provider.providerId || '')).join('')}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    ` : '';
    const checksHtml = checks.length ? checks.map((item) => {
        const modeLabel = getAiImageProbeModeLabel(item.mode);
        const latency = Number(item.latencyMs || 0)
            ? `${(Number(item.latencyMs) / 1000).toFixed(1)}s`
            : '-';
        const statusLabel = item.ok ? '可用' : '失败';
        const upstreamText = getAiImageProbeUpstreamText(item.upstream);
        const detail = item.ok
            ? `${item.model || ''} · ${item.endpoint || ''} · ${item.size || ''} · ${item.resultType || '结果'} · ${latency}${upstreamText ? ` · ${upstreamText}` : ''}`
            : `${item.code || 'probe_failed'} · ${item.message || '上游不可用'}${upstreamText ? ` · ${upstreamText}` : ''}`;
        return `
            <div class="ai-image-admin-probe-item ${item.ok ? 'is-ok' : 'is-error'}">
                <strong>${escapeHtml([modeLabel, String(item.resolution || '').toUpperCase()].filter(Boolean).join(' · '))}</strong>
                <span>${escapeHtml(statusLabel)}</span>
                <em>${escapeHtml(detail)}</em>
            </div>
        `;
    }).join('') : '';
    return `${discoveryHtml}${checksHtml}`;
}

function renderAiImageProviderProbePanel(provider = {}) {
    const probe = getAiImageProviderProbe(provider.providerId || '');
    const status = getAiImageProviderProbeStatus(probe, provider);
    const gridHtml = renderAiImageProbeGridHtml(probe, provider);
    return `
        <div class="ai-image-admin-provider-probe" data-provider-probe="${escapeHtml(provider.providerId || '')}">
            <p class="settings-status ai-image-admin-model-status ai-image-admin-provider-probe__status">
                <span class="status-dot ${escapeHtml(status.tone || '')}"></span>
                <span>${escapeHtml(status.text)}</span>
            </p>
            ${gridHtml ? `<div class="ai-image-admin-probe-grid">${gridHtml}</div>` : ''}
        </div>
    `;
}

function hasAiImageModelsListValue(...values) {
    return values.some((value) => {
        if (Array.isArray(value)) {
            return value.some((item) => String(item || '').trim());
        }
        return String(value || '').trim();
    });
}

function normalizeAiImageModelGroup(value, fallback = 'image') {
    const normalized = String(value || '').trim().toLowerCase();
    if (['image', 'chat', 'video', 'both'].includes(normalized)) return normalized;
    return ['image', 'chat', 'video', 'both'].includes(fallback) ? fallback : 'image';
}

function hasExplicitAiImageModelGroup(value) {
    return ['image', 'chat', 'video', 'both'].includes(String(value || '').trim().toLowerCase());
}

function inferAiImageModelGroup(value, imageModels = [], chatModels = [], videoModels = [], fallback = 'image') {
    const normalized = normalizeAiImageModelGroup(value, fallback);
    const hasImageModels = normalizeAiImageModelsList(imageModels, '').length > 0;
    const hasChatModels = normalizeAiImageModelsList(chatModels, '').length > 0;
    const hasVideoModels = normalizeAiImageModelsList(videoModels, '').length > 0;
    if (hasVideoModels && !hasImageModels && !hasChatModels) return 'video';
    if (hasImageModels && hasChatModels) return 'both';
    if (hasChatModels && normalized === 'image') return 'chat';
    if (hasImageModels && normalized === 'chat') return 'image';
    return normalized;
}

function scopeAiImageModelsByGroup(modelGroup = 'image', imageModels = [], chatModels = [], videoModels = []) {
    const group = normalizeAiImageModelGroup(modelGroup, 'image');
    return {
        modelGroup: group,
        imageModels: group === 'chat' || group === 'video' ? [] : normalizeAiImageModelsList(imageModels, ''),
        chatModels: group === 'image' || group === 'video' ? [] : normalizeAiImageModelsList(chatModels, ''),
        videoModels: normalizeAiImageModelsList(videoModels, '')
    };
}

function normalizeAiImageModelVendor(value, fallback = 'openai') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'other') return 'custom';
    const normalizedFallback = String(fallback || 'openai').trim().toLowerCase();
    const safeFallback = normalizedFallback === 'other' ? 'custom' : normalizedFallback;
    return ['openai', 'gemini', 'anthropic', 'flux', 'sub2api', 'custom'].includes(normalized)
        ? normalized
        : (['openai', 'gemini', 'anthropic', 'flux', 'sub2api', 'custom'].includes(safeFallback) ? safeFallback : 'openai');
}

function normalizeAiImageModelProtocol(value, fallback = 'openai-compatible') {
    const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    return ['openai-compatible', 'gemini-native', 'anthropic-native', 'custom'].includes(normalized) ? normalized : fallback;
}

function normalizeAiImageModelProvider(provider = {}) {
    const providerId = normalizeAiImageProviderId(provider.providerId || provider.provider_id || provider.id);
    const model = normalizeAiImageOptionalModelName(provider.model);
    const models = normalizeAiImageModelsList(provider.models || provider.modelAliases || provider.model_aliases, '');
    const chatModels = normalizeAiImageModelsList(provider.chatModels || provider.chat_models || provider.chatModelAliases || provider.chat_model_aliases, '');
    const videoModels = normalizeAiImageModelsList(provider.videoModels || provider.video_models || provider.videoModelAliases || provider.video_model_aliases, '');
    const rawModelGroup = provider.modelGroup || provider.model_group;
    const configuredModelGroup = normalizeAiImageModelGroup(rawModelGroup, videoModels.length && !chatModels.length ? 'video' : (chatModels.length && models.length ? 'both' : (chatModels.length ? 'chat' : 'image')));
    const hasExplicitImageModels = hasAiImageModelsListValue(
        provider.imageModels,
        provider.image_models,
        provider.imageModelAliases,
        provider.image_model_aliases
    );
    const imageModels = configuredModelGroup === 'chat' && !hasExplicitImageModels
        ? []
        : normalizeAiImageModelsList(provider.imageModels || provider.image_models || provider.imageModelAliases || provider.image_model_aliases || provider.models || models, '');
    const modelGroup = hasExplicitAiImageModelGroup(rawModelGroup)
        ? configuredModelGroup
        : inferAiImageModelGroup(configuredModelGroup, imageModels, chatModels, videoModels, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
    const scopedModels = scopeAiImageModelsByGroup(modelGroup, imageModels, chatModels, videoModels);
    const detectedImageModels = mergeAiImageModelCandidates(
        provider.detectedImageModels,
        provider.detected_image_models,
        provider.discoveredImageModels,
        provider.discovered_image_models,
        scopedModels.imageModels
    );
    const detectedChatModels = mergeAiImageModelCandidates(
        provider.detectedChatModels,
        provider.detected_chat_models,
        provider.discoveredChatModels,
        provider.discovered_chat_models,
        scopedModels.chatModels
    );
    const detectedVideoModels = mergeAiImageModelCandidates(
        provider.detectedVideoModels,
        provider.detected_video_models,
        provider.discoveredVideoModels,
        provider.discovered_video_models,
        scopedModels.videoModels
    );
    const detectedUnknownModels = mergeAiImageModelCandidates(
        provider.detectedUnknownModels,
        provider.detected_unknown_models,
        provider.discoveredUnknownModels,
        provider.discovered_unknown_models,
        provider.unknownModels,
        provider.unknown_models
    );
    const visionModels = mergeAiImageModelCandidates(
        provider.visionModels,
        provider.vision_models,
        provider.chatVisionModels,
        provider.chat_vision_models
    );
    const rawVendor = provider.vendor || provider.provider;
    const vendor = normalizeAiImageModelVendor(rawVendor, DEFAULT_AI_IMAGE_MODEL_CONFIG.vendor);
    const vendorLabel = normalizeAiImageModelVendorLabel(
        provider.vendorLabel || provider.vendor_label || provider.vendorName || provider.vendor_name,
        String(rawVendor || '').trim().toLowerCase() === 'sub2api' ? 'Sub2API' : ''
    );
    return {
        providerId,
        provider_id: providerId,
        label: String(provider.label || provider.name || providerId).trim().slice(0, 120) || providerId,
        configured: Boolean(provider.configured),
        source: provider.source || 'missing',
        baseUrl: normalizeAiImageModelBaseUrl(provider.baseUrl || provider.base_url || DEFAULT_AI_IMAGE_MODEL_CONFIG.baseUrl),
        vendor,
        vendorLabel,
        vendor_label: vendorLabel,
        protocol: normalizeAiImageModelProtocol(provider.protocol || provider.adapter, DEFAULT_AI_IMAGE_MODEL_CONFIG.protocol),
        modelGroup,
        model_group: modelGroup,
        model,
        models: scopedModels.imageModels,
        imageModels: scopedModels.imageModels,
        image_models: scopedModels.imageModels,
        chatModels: scopedModels.chatModels,
        chat_models: scopedModels.chatModels,
        videoModels: scopedModels.videoModels,
        video_models: scopedModels.videoModels,
        detectedImageModels,
        detected_image_models: detectedImageModels,
        detectedChatModels,
        detected_chat_models: detectedChatModels,
        detectedVideoModels,
        detected_video_models: detectedVideoModels,
        detectedUnknownModels,
        detected_unknown_models: detectedUnknownModels,
        visionModels,
        vision_models: visionModels,
        isActive: provider.isActive !== false && provider.is_active !== false,
        displayOrder: Number(provider.displayOrder ?? provider.display_order ?? 0) || 0,
        updatedAt: provider.updatedAt || provider.updated_at || null,
        decryptErrorMessage: String(provider.decryptErrorMessage || '').trim()
    };
}

function getAiImageModelProviders(config = getAiImageModelConfig()) {
    const providers = Array.isArray(config.providers)
        ? config.providers.map(normalizeAiImageModelProvider)
        : [];
    if (providers.length) return providers;
    return [normalizeAiImageModelProvider(config)];
}

function getSelectedAiImageModelProvider(config = getAiImageModelConfig()) {
    const providers = getAiImageModelProviders(config);
    const selectedId = normalizeAiImageProviderId(adminAiImageState.selectedModelProviderId || config.providerId || 'default');
    return providers.find((provider) => provider.providerId === selectedId) || providers[0] || normalizeAiImageModelProvider(config);
}

function getAiImageModelConfig() {
    const current = adminAiImageState.modelConfig;
    const providers = Array.isArray(current?.providers)
        ? current.providers.map(normalizeAiImageModelProvider)
        : [];
    const fallbackProvider = normalizeAiImageModelProvider({
        ...DEFAULT_AI_IMAGE_MODEL_CONFIG,
        ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {})
    });
    const mergedProviders = providers.length ? providers : [fallbackProvider];
    const selected = mergedProviders.find((provider) => provider.providerId === normalizeAiImageProviderId(adminAiImageState.selectedModelProviderId))
        || mergedProviders[0]
        || fallbackProvider;
    const modelGroup = normalizeAiImageModelGroup(
        selected.modelGroup || selected.model_group || current?.modelGroup || current?.model_group,
        DEFAULT_AI_IMAGE_MODEL_CONFIG.modelGroup
    );
    const scopedModels = scopeAiImageModelsByGroup(
        modelGroup,
        normalizeAiImageModelsList(
            selected.imageModels || selected.image_models || current?.imageModels || current?.image_models || selected.models || current?.models,
            ''
        ),
        normalizeAiImageModelsList(selected.chatModels || selected.chat_models || current?.chatModels || current?.chat_models, ''),
        normalizeAiImageModelsList(selected.videoModels || selected.video_models || current?.videoModels || current?.video_models, '')
    );
    const detectedImageModels = mergeAiImageModelCandidates(
        selected.detectedImageModels,
        selected.detected_image_models,
        current?.detectedImageModels,
        current?.detected_image_models,
        scopedModels.imageModels
    );
    const detectedChatModels = mergeAiImageModelCandidates(
        selected.detectedChatModels,
        selected.detected_chat_models,
        current?.detectedChatModels,
        current?.detected_chat_models,
        scopedModels.chatModels
    );
    const detectedVideoModels = mergeAiImageModelCandidates(
        selected.detectedVideoModels,
        selected.detected_video_models,
        current?.detectedVideoModels,
        current?.detected_video_models,
        scopedModels.videoModels
    );
    const detectedUnknownModels = mergeAiImageModelCandidates(
        selected.detectedUnknownModels,
        selected.detected_unknown_models,
        current?.detectedUnknownModels,
        current?.detected_unknown_models
    );
    const visionModels = mergeAiImageModelCandidates(
        selected.visionModels,
        selected.vision_models,
        current?.visionModels,
        current?.vision_models
    );
    return {
        ...DEFAULT_AI_IMAGE_MODEL_CONFIG,
        ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
        providerId: selected.providerId,
        provider_id: selected.providerId,
        label: selected.label,
        configured: Boolean(selected.configured || current?.configured),
        source: selected.source || current?.source || DEFAULT_AI_IMAGE_MODEL_CONFIG.source,
        vendor: selected.vendor || current?.vendor || DEFAULT_AI_IMAGE_MODEL_CONFIG.vendor,
        vendorLabel: selected.vendorLabel || selected.vendor_label || current?.vendorLabel || current?.vendor_label || DEFAULT_AI_IMAGE_MODEL_CONFIG.vendorLabel,
        vendor_label: selected.vendorLabel || selected.vendor_label || current?.vendorLabel || current?.vendor_label || DEFAULT_AI_IMAGE_MODEL_CONFIG.vendorLabel,
        protocol: selected.protocol || current?.protocol || DEFAULT_AI_IMAGE_MODEL_CONFIG.protocol,
        modelGroup: scopedModels.modelGroup,
        model_group: scopedModels.modelGroup,
        baseUrl: normalizeAiImageModelBaseUrl(selected.baseUrl || current?.baseUrl || DEFAULT_AI_IMAGE_MODEL_CONFIG.baseUrl),
        model: normalizeAiImageOptionalModelName(selected.model || current?.model || scopedModels.imageModels[0] || scopedModels.chatModels[0] || scopedModels.videoModels[0] || ''),
        models: scopedModels.imageModels,
        imageModels: scopedModels.imageModels,
        chatModels: scopedModels.chatModels,
        videoModels: scopedModels.videoModels,
        detectedImageModels,
        detectedChatModels,
        detectedVideoModels,
        detectedUnknownModels,
        visionModels,
        providers: mergedProviders,
        decryptErrorMessage: String(current?.decryptErrorMessage || '').trim()
    };
}

function setAiImageModelConfig(payload = {}) {
    const normalizedPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const providers = Array.isArray(normalizedPayload.providers)
        ? normalizedPayload.providers.map(normalizeAiImageModelProvider)
        : undefined;
    adminAiImageState.modelConfig = {
        ...getAiImageModelConfig(),
        ...normalizedPayload,
        ...(providers ? { providers } : {})
    };
    if (normalizedPayload.providerId || normalizedPayload.provider_id) {
        adminAiImageState.selectedModelProviderId = normalizeAiImageProviderId(normalizedPayload.providerId || normalizedPayload.provider_id);
    } else if (!adminAiImageState.selectedModelProviderId && providers?.[0]) {
        adminAiImageState.selectedModelProviderId = providers[0].providerId;
    }
    return getAiImageModelConfig();
}

function getAiImageModelSourceMeta(config = getAiImageModelConfig()) {
    const decryptErrorMessage = String(config.decryptErrorMessage || '').trim();
    if (decryptErrorMessage) {
        return {
            source: 'missing',
            badge: '需重录',
            statusText: decryptErrorMessage
        };
    }

    if (config.source === 'stored') {
        return {
            source: 'stored',
            badge: '后台托管',
            statusText: `AI 图片模型已托管 · ${config.baseUrl} · ${config.model}`
        };
    }

    if (config.source === 'environment') {
        return {
            source: 'environment',
            badge: '环境变量',
            statusText: `AI 图片模型当前由环境变量托管 · ${config.baseUrl} · ${config.model}`
        };
    }

    return {
        source: 'missing',
        badge: '待配置',
        statusText: '未配置 AI 图片上游，请录入 Key、填写 Base URL，并检测上游支持模型'
    };
}

function normalizeAiImageGuardrailInt(value, fallback = 1, { min = 1, max = 100000 } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeAiImageGuardrailWindow(value = {}, fallback = {}, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        limit: normalizeAiImageGuardrailInt(source.limit ?? source.max ?? source.limit_value, fallback.limit, {
            min: options.minLimit || 1,
            max: options.maxLimit || 100000
        }),
        windowMs: normalizeAiImageGuardrailInt(source.windowMs ?? source.window_ms ?? source.window, fallback.windowMs, {
            min: 1000,
            max: 86400000
        })
    };
}

function normalizeAiImageGuardrails(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const defaults = DEFAULT_AI_IMAGE_GUARDRAILS;
    return {
        submit: {
            global: normalizeAiImageGuardrailWindow(source.submit?.global, defaults.submit.global, { maxLimit: 10000 }),
            ip: normalizeAiImageGuardrailWindow(source.submit?.ip, defaults.submit.ip, { maxLimit: 10000 }),
            user: normalizeAiImageGuardrailWindow(source.submit?.user, defaults.submit.user, { maxLimit: 10000 }),
            heavyUser: normalizeAiImageGuardrailWindow(source.submit?.heavyUser || source.submit?.heavy_user, defaults.submit.heavyUser, { maxLimit: 10000 }),
            model: normalizeAiImageGuardrailWindow(source.submit?.model, defaults.submit.model, { maxLimit: 10000 })
        },
        upload: {
            global: normalizeAiImageGuardrailWindow(source.upload?.global, defaults.upload.global, { maxLimit: 10000 }),
            ip: normalizeAiImageGuardrailWindow(source.upload?.ip, defaults.upload.ip, { maxLimit: 10000 }),
            user: normalizeAiImageGuardrailWindow(source.upload?.user, defaults.upload.user, { maxLimit: 10000 })
        },
        download: {
            global: normalizeAiImageGuardrailWindow(source.download?.global, defaults.download.global, { maxLimit: 100000 }),
            ip: normalizeAiImageGuardrailWindow(source.download?.ip, defaults.download.ip, { maxLimit: 100000 }),
            user: normalizeAiImageGuardrailWindow(source.download?.user, defaults.download.user, { maxLimit: 100000 }),
            resource: normalizeAiImageGuardrailWindow(source.download?.resource, defaults.download.resource, { maxLimit: 100000 })
        },
        tasks: {
            running: normalizeAiImageGuardrailInt(source.tasks?.running ?? source.tasks?.runningLimit, defaults.tasks.running, { min: 1, max: 20 }),
            queued: normalizeAiImageGuardrailInt(source.tasks?.queued ?? source.tasks?.queuedLimit, defaults.tasks.queued, { min: 1, max: 100 }),
            active: normalizeAiImageGuardrailInt(source.tasks?.active ?? source.tasks?.activeLimit, defaults.tasks.active, { min: 1, max: 100 })
        }
    };
}

function getAiImageGuardrails() {
    return normalizeAiImageGuardrails(adminAiImageState.guardrails || DEFAULT_AI_IMAGE_GUARDRAILS);
}

function normalizeAiImageStorageNumber(value, fallback = 0, { min = 0, max = 100000 } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
}

function normalizeAiImageStorageInt(value, fallback = 30, { min = 1, max = 3650 } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeAiImageStoragePolicy(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const policy = {
        previewRetentionDays: normalizeAiImageStorageInt(
            source.previewRetentionDays ?? source.preview_retention_days,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.previewRetentionDays,
            { min: 7, max: 3650 }
        ),
        originalRetentionDays: normalizeAiImageStorageInt(
            source.originalRetentionDays ?? source.original_retention_days,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.originalRetentionDays,
            { min: 7, max: 3650 }
        ),
        failedRetentionDays: normalizeAiImageStorageInt(
            source.failedRetentionDays ?? source.failed_retention_days,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.failedRetentionDays,
            { min: 1, max: 3650 }
        ),
        warnStorageGb: normalizeAiImageStorageNumber(
            source.warnStorageGb ?? source.warn_storage_gb,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.warnStorageGb,
            { min: 0.1, max: 100000 }
        ),
        stopStorageGb: normalizeAiImageStorageNumber(
            source.stopStorageGb ?? source.stop_storage_gb,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.stopStorageGb,
            { min: 0.1, max: 100000 }
        ),
        lifecycleEnabled: Boolean(source.lifecycleEnabled ?? source.lifecycle_enabled ?? DEFAULT_AI_IMAGE_STORAGE_POLICY.lifecycleEnabled)
    };
    if (policy.warnStorageGb > policy.stopStorageGb) {
        policy.stopStorageGb = policy.warnStorageGb;
    }
    return policy;
}

function getAiImageStoragePolicy() {
    return normalizeAiImageStoragePolicy(adminAiImageState.storagePolicy || DEFAULT_AI_IMAGE_STORAGE_POLICY);
}

function getAiImageStorageUsage() {
    const source = adminAiImageState.storageUsage && typeof adminAiImageState.storageUsage === 'object'
        ? adminAiImageState.storageUsage
        : {};
    return {
        sampledResults: Number(source.sampled_results ?? source.sampledResults ?? 0) || 0,
        previewObjects: Number(source.preview_objects ?? source.previewObjects ?? 0) || 0,
        originalObjects: Number(source.original_objects ?? source.originalObjects ?? 0) || 0,
        previewBytes: Number(source.preview_bytes ?? source.previewBytes ?? 0) || 0,
        originalBytes: Number(source.original_bytes ?? source.originalBytes ?? 0) || 0,
        totalBytes: Number(source.total_bytes ?? source.totalBytes ?? 0) || 0,
        estimatedTotalGb: Number(source.estimated_total_gb ?? source.estimatedTotalGb ?? 0) || 0,
        unknownPreviewObjects: Number(source.unknown_preview_objects ?? source.unknownPreviewObjects ?? 0) || 0,
        unknownOriginalObjects: Number(source.unknown_original_objects ?? source.unknownOriginalObjects ?? 0) || 0,
        pendingOriginals: Number(source.pending_originals ?? source.pendingOriginals ?? 0) || 0,
        failedOriginals: Number(source.failed_originals ?? source.failedOriginals ?? 0) || 0,
        tone: String(source.tone || 'ready'),
        errorMessage: String(source.error_message || source.errorMessage || '').trim()
    };
}

function getAiImageConfigUrl(params = {}) {
    const searchParams = new URLSearchParams({
        route: 'ai-image/config',
        site: normalizeAdminAiImageSite()
    });

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim()) {
            searchParams.set(key, String(value));
        }
    });

    return `/api/admin?${searchParams.toString()}`;
}

function getAiImageModelConfigUrl() {
    return '/api/admin?route=ai-image/model-config';
}

async function fetchAiImageModelConfig(options = {}) {
    try {
        const headers = await getAdminApiHeaders();
        const response = await (window.AdminApi?.fetch || fetch)(getAiImageModelConfigUrl(), {
            method: 'GET',
            headers
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '读取 AI 图片模型配置失败');
        }
        setAiImageModelConfig(payload);
        if (options.render !== false) {
            renderAiImageModelConfigPanel();
        }
        return payload;
    } catch (err) {
        console.warn('Failed to load AI image model config:', err);
        if (options.silent !== true) {
            showAdminStudioToast(err.message || '读取 AI 图片模型配置失败', 'error');
        }
        return null;
    }
}

async function fetchAiImageAdminConfig(options = {}) {
    if (adminAiImageState.loading && !options.force) return null;
    adminAiImageState.loading = true;
    renderAiImageAdminPanel();

    try {
        const headers = await getAdminApiHeaders();
        const response = await (window.AdminApi?.fetch || fetch)(getAiImageConfigUrl(), {
            method: 'GET',
            headers
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '读取 AI 图片配置失败');
        }

        adminAiImageState.agents = Array.isArray(payload.agents) ? payload.agents : [];
        adminAiImageState.pricing = Array.isArray(payload.pricing) ? payload.pricing : [];
        adminAiImageState.apiBaseUrls = Array.isArray(payload.api_base_urls) ? payload.api_base_urls : [];
        adminAiImageState.guardrails = normalizeAiImageGuardrails(payload.guardrails || {});
        adminAiImageState.storagePolicy = normalizeAiImageStoragePolicy(payload.storage_policy || payload.storagePolicy || {});
        adminAiImageState.storageUsage = payload.storage_usage || payload.storageUsage || null;
        adminAiImageState.warnings = payload.warnings && typeof payload.warnings === 'object' ? payload.warnings : {};
        adminAiImageState.runtime = payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : null;
        const runtimeModel = adminAiImageState.runtime?.model || null;
        if (runtimeModel && !adminAiImageState.modelConfig) {
            setAiImageModelConfig({
                configured: Boolean(runtimeModel.configured),
                source: runtimeModel.source === 'ai-image-stored'
                    ? 'stored'
                    : (runtimeModel.source === 'ai-image-env' ? 'environment' : 'missing'),
                model: runtimeModel.model || ADMIN_AI_IMAGE_DEFAULT_MODEL,
                baseUrl: ''
            });
        }
        void fetchAiImageModelConfig({ silent: true, render: true });
        adminAiImageState.loaded = true;
        return payload;
    } catch (err) {
        console.error('Failed to load AI image config:', err);
        showAdminStudioToast(err.message || '读取 AI 图片配置失败', 'error');
        return null;
    } finally {
        adminAiImageState.loading = false;
        renderAiImageAdminPanel();
    }
}

function formatAiImageDateTime(value = '') {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getAiImageRuntimeText(kind = '') {
    const runtime = adminAiImageState.runtime || {};
    const model = runtime.model || {};
    const storage = runtime.storage || {};
    const queue = runtime.queue || {};
    const counts = queue.counts || {};

    if (kind === 'model') {
        if (!model.configured) return '未配置模型 Key';
        const source = model.source_label || '已配置';
        const tail = model.api_key_tail ? ` · ****${model.api_key_tail}` : '';
        return `${model.model || ADMIN_AI_IMAGE_DEFAULT_MODEL} · ${source}${tail}`;
    }

    if (kind === 'storage') {
        if (storage.configured) {
            return `${storage.bucket || 'R2'} · ${storage.public_url || '公开地址已配置'}`;
        }
        if (storage.inline_data_urls_allowed) {
            return '开发模式 inline data URL';
        }
        return '未配置 R2 存储';
    }

    if (kind === 'queue') {
        if (queue.error_message) return `查询失败：${queue.error_message}`;
        const queued = Number(counts.queued || 0);
        const running = Number(counts.running || 0);
        const failed = Number(counts.failed || 0);
        const oldest = Number(queue.oldest_queued_minutes || 0);
        return `排队 ${queued} · 运行 ${running} · 失败 ${failed}${oldest ? ` · 最久 ${oldest} 分钟` : ''}`;
    }

    if (kind === 'failure') {
        const failure = queue.recent_failure || null;
        if (!failure) return '暂无失败任务';
        const time = formatAiImageDateTime(failure.failed_at);
        const code = failure.error_code || 'ai_image_failed';
        const message = failure.error_message || '无错误详情';
        return `${time ? `${time} · ` : ''}${code} · ${message}`;
    }

    return '待检测';
}

function getAiImageRuntimeHealth() {
    const runtime = adminAiImageState.runtime || {};
    const model = runtime.model || {};
    const storage = runtime.storage || {};
    const queue = runtime.queue || {};
    const counts = queue.counts || {};

    if (adminAiImageState.loading) return 'loading';
    if (!runtime || !adminAiImageState.loaded) return 'idle';
    if (!model.configured || (!storage.configured && !storage.inline_data_urls_allowed) || queue.error_message) {
        return 'error';
    }
    if (Number(counts.failed || 0) > 0 || Number(queue.oldest_queued_minutes || 0) >= 20 || model.warning) {
        return 'warning';
    }
    return 'ready';
}

function renderAiImageRuntimeStatus() {
    const modelEl = document.querySelector('[data-ai-image-runtime="model"]');
    const storageEl = document.querySelector('[data-ai-image-runtime="storage"]');
    const queueEl = document.querySelector('[data-ai-image-runtime="queue"]');
    const failureEl = document.querySelector('[data-ai-image-runtime="failure"]');
    const workerStatus = document.getElementById('aiImageWorkerStatus');

    if (modelEl) {
        modelEl.textContent = getAiImageRuntimeText('model');
    }
    if (storageEl) {
        storageEl.textContent = getAiImageRuntimeText('storage');
    }
    if (queueEl) {
        queueEl.textContent = getAiImageRuntimeText('queue');
    }
    if (failureEl) {
        failureEl.textContent = getAiImageRuntimeText('failure');
    }

    if (workerStatus) {
        const dot = workerStatus.querySelector('.status-dot');
        const text = workerStatus.querySelector('span:last-child');
        const run = adminAiImageState.lastRun;
        if (run) {
            const failed = Number(run.failed || 0);
            dot.className = `status-dot ${failed ? 'error' : 'ready'}`;
            text.textContent = `最近执行：处理 ${Number(run.processed || 0)} 个，成功 ${Number(run.succeeded || 0)} 个，失败 ${failed} 个`;
        } else if (adminAiImageState.loading) {
            dot.className = 'status-dot';
            text.textContent = '正在加载 AI 图片配置和队列状态...';
        } else {
            const health = getAiImageRuntimeHealth();
            dot.className = `status-dot ${health}`;
            const runtime = adminAiImageState.runtime || {};
            const model = runtime.model || {};
            const storage = runtime.storage || {};
            if (health === 'ready') {
                text.textContent = '模型、存储和队列状态正常';
            } else if (health === 'warning') {
                text.textContent = model.warning || '队列存在失败任务或等待时间较长';
            } else if (health === 'error') {
                text.textContent = model.error_message
                    || runtime.queue?.error_message
                    || (!model.configured ? '模型 Key 或 Base URL 未配置' : 'R2 图片存储未配置');
            } else {
                text.textContent = '尚未执行队列检查';
            }
        }
    }
}

function getAiImageProviderSourceLabel(provider = {}) {
    if (!provider.configured) return '未配置';
    if (provider.source === 'environment') return '环境变量';
    if (provider.source === 'stored') return '后台托管';
    return '已配置';
}

function syncAiImageModelVendorCustomField(vendor = '', { focus = false } = {}) {
    const vendorLabelInput = document.getElementById('aiImageModelVendorLabelInput');
    if (!vendorLabelInput) return false;
    const isCustom = isAiImageCustomVendor(vendor);
    vendorLabelInput.hidden = !isCustom;
    vendorLabelInput.required = isCustom;
    vendorLabelInput.setAttribute('aria-hidden', isCustom ? 'false' : 'true');
    if (!isCustom && document.activeElement !== vendorLabelInput) {
        vendorLabelInput.value = '';
    }
    if (isCustom && focus && typeof vendorLabelInput.focus === 'function') {
        vendorLabelInput.focus();
        if (typeof vendorLabelInput.select === 'function') {
            vendorLabelInput.select();
        }
    }
    return isCustom;
}

function renderAiImageModelConfigPanel() {
    const config = getAiImageModelConfig();
    const meta = getAiImageModelSourceMeta(config);
    const provider = getAiImageEditingModelProvider(config);
    const providerIdInput = document.getElementById('aiImageModelProviderIdInput');
    const providerLabelInput = document.getElementById('aiImageModelProviderLabelInput');
    const vendorInput = document.getElementById('aiImageModelVendorInput');
    const vendorLabelInput = document.getElementById('aiImageModelVendorLabelInput');
    const protocolInput = document.getElementById('aiImageModelProtocolInput');
    const baseUrlInput = document.getElementById('aiImageModelBaseUrlInput');
    const badge = document.getElementById('aiImageModelConfigSourceBadge');
    const status = document.getElementById('aiImageModelConfigStatus');
    const providerList = document.getElementById('aiImageModelProviderList');
    const providerDetail = document.getElementById('aiImageModelProviderDetail');
    const probeButton = document.getElementById('aiImageModelProbeButton');
    const discoveryButton = document.getElementById('aiImageModelDiscoveryButton');
    const deleteButton = document.getElementById('aiImageModelDeleteButton');

    if (providerIdInput) {
        providerIdInput.value = provider.providerId || 'default';
    }

    if (providerLabelInput && document.activeElement !== providerLabelInput) {
        providerLabelInput.value = provider.label || provider.providerId || '默认上游';
    }

    const visibleVendor = provider.vendor === 'sub2api'
        ? 'custom'
        : normalizeAiImageModelVendor(provider.vendor || config.vendor || DEFAULT_AI_IMAGE_MODEL_CONFIG.vendor);
    if (vendorInput && document.activeElement !== vendorInput) {
        vendorInput.value = visibleVendor;
        if (typeof setCustomDropdownValue === 'function') {
            setCustomDropdownValue('aiImageModelVendorDropdown', vendorInput.value);
        }
    }
    if (vendorLabelInput && document.activeElement !== vendorLabelInput) {
        vendorLabelInput.value = normalizeAiImageModelVendorLabel(provider.vendorLabel || provider.vendor_label || config.vendorLabel || config.vendor_label);
    }
    syncAiImageModelVendorCustomField(visibleVendor);

    if (protocolInput && document.activeElement !== protocolInput) {
        protocolInput.value = provider.protocol || config.protocol || DEFAULT_AI_IMAGE_MODEL_CONFIG.protocol;
        if (typeof setCustomDropdownValue === 'function') {
            setCustomDropdownValue('aiImageModelProtocolDropdown', protocolInput.value);
        }
    }

    if (baseUrlInput && document.activeElement !== baseUrlInput) {
        baseUrlInput.value = provider.baseUrl || config.baseUrl || DEFAULT_AI_IMAGE_MODEL_CONFIG.baseUrl;
    }

    setAiImageHiddenModelInputValues(provider);

    if (badge) {
        badge.textContent = `${getAiImageProviderSourceLabel(provider)} · ${provider.label || provider.providerId}`;
    }

    if (status) {
        const dot = status.querySelector('.status-dot');
        const text = status.querySelector('span:last-child');
        if (provider.configured) {
            dot.className = provider.source === 'stored' || provider.source === 'environment'
                ? 'status-dot ready'
                : 'status-dot warning';
            const visibleSummary = [
                getAiImageModelCountLabel(provider.chatModels?.length || 0, '文本'),
                getAiImageModelCountLabel(provider.imageModels?.length || 0, '生图'),
                getAiImageModelCountLabel(provider.videoModels?.length || 0, '视频')
            ].join(' · ');
            text.textContent = `${provider.label || provider.providerId} 已配置 · ${provider.baseUrl || '未填写 Base URL'} · ${visibleSummary}`;
        } else {
            dot.className = 'status-dot error';
            text.textContent = adminAiImageState.modelProviderDraft
                ? '正在新增上游：先填写名称、Base URL 并录入 Key，再检测模型。'
                : meta.statusText;
        }
    }

    if (providerList) {
        const providers = getAiImageModelProviders(config);
        const draftProvider = adminAiImageState.modelProviderDraft
            ? normalizeAiImageModelProvider(adminAiImageState.modelProviderDraft)
            : null;
        const listProviders = draftProvider && !providers.some((item) => item.providerId === draftProvider.providerId)
            ? [draftProvider, ...providers]
            : providers;
        const shouldShowLoading = adminAiImageState.loading && !adminAiImageState.modelConfig && !draftProvider;
        if (shouldShowLoading) {
            providerList.innerHTML = `
                <div class="ai-image-admin-provider-list-loading" aria-live="polite">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
        } else {
            providerList.innerHTML = listProviders.map((item) => {
                const active = item.providerId === provider.providerId;
                const imageModels = (item.imageModels?.length ? item.imageModels : item.models || []).slice(0, 3).join(' / ');
                const chatModels = (item.chatModels || []).slice(0, 3).join(' / ');
                const videoModels = (item.videoModels || []).slice(0, 3).join(' / ');
                const modelSummary = [
                    chatModels ? `文本：${chatModels}` : '文本：空',
                    imageModels ? `生图：${imageModels}` : '生图：空',
                    videoModels ? `视频：${videoModels}` : '视频：空'
                ].filter(Boolean).join(' · ');
                return `
                    <button class="ai-image-admin-provider-list-item ${active ? 'is-active' : ''} ${item.source === 'missing' ? 'is-draft' : ''}" type="button"
                        data-admin-action="settings-select-ai-image-model-provider"
                        data-provider-id="${escapeHtml(item.providerId)}"
                        aria-pressed="${active ? 'true' : 'false'}">
                        <span class="ai-image-admin-provider-list-item__main">
                            <strong>${escapeHtml(item.label || item.providerId)}</strong>
                            <span>${escapeHtml(item.baseUrl || '未配置 Base URL')}</span>
                            <small>${escapeHtml(modelSummary)}</small>
                        </span>
                    </button>
                `;
            }).join('');
        }
    }

    const canProbe = Boolean(provider.configured);
    const canDelete = provider.source === 'stored';
    [
        {
            button: probeButton,
            enabled: canProbe,
            title: canProbe ? '检测当前上游的前台可见模型可用性' : '请先录入并保存 API Key 后再运行模型自检'
        },
        {
            button: discoveryButton,
            enabled: canProbe,
            title: canProbe ? '检测当前上游支持的模型并刷新候选列表' : '请先录入并保存 API Key 后再检测模型'
        },
        {
            button: deleteButton,
            enabled: canDelete,
            title: canDelete ? '删除当前上游后台安全存储配置' : '只有后台托管的上游可以在这里删除'
        }
    ].forEach(({ button, enabled, title }) => {
        if (!button) return;
        button.dataset.providerId = provider.providerId || '';
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        button.title = title;
    });

    if (providerDetail) {
        const probePanel = provider.configured || getAiImageProviderProbe(provider.providerId || '')
            ? renderAiImageProviderProbePanel(provider)
            : '';
        providerDetail.innerHTML = `
            ${provider.decryptErrorMessage ? `<div class="ai-image-admin-empty ai-image-admin-empty--warning">${escapeHtml(provider.decryptErrorMessage)}</div>` : ''}
            ${probePanel}
            <div class="ai-image-admin-provider-models ai-image-admin-provider-models--detail">
                ${renderAiImageProviderVisibleModelSection(provider)}
            </div>
        `;
    }
}

function readAiImageModelDraftConfig() {
    const current = getAiImageModelConfig();
    const provider = getAiImageEditingModelProvider(current);
    const providerIdInput = document.getElementById('aiImageModelProviderIdInput');
    const providerLabelInput = document.getElementById('aiImageModelProviderLabelInput');
    const vendorInput = document.getElementById('aiImageModelVendorInput');
    const vendorLabelInput = document.getElementById('aiImageModelVendorLabelInput');
    const protocolInput = document.getElementById('aiImageModelProtocolInput');
    const baseUrlInput = document.getElementById('aiImageModelBaseUrlInput');
    const aliasesInput = document.getElementById('aiImageModelAliasesInput');
    const chatAliasesInput = document.getElementById('aiImageChatModelAliasesInput');
    const videoAliasesInput = document.getElementById('aiImageVideoModelAliasesInput');
    const detectedImageModelsInput = document.getElementById('aiImageDetectedImageModelsInput');
    const detectedChatModelsInput = document.getElementById('aiImageDetectedChatModelsInput');
    const detectedVideoModelsInput = document.getElementById('aiImageDetectedVideoModelsInput');
    const detectedUnknownModelsInput = document.getElementById('aiImageDetectedUnknownModelsInput');
    const visionModelsInput = document.getElementById('aiImageVisionModelsInput');
    const draftImageModels = normalizeAiImageModelsList(aliasesInput?.value || provider.imageModels || provider.image_models || provider.models || current.imageModels || current.models, '');
    const draftChatModels = normalizeAiImageModelsList(chatAliasesInput?.value || provider.chatModels || provider.chat_models || current.chatModels, '');
    const draftVideoModels = normalizeAiImageModelsList(videoAliasesInput?.value || provider.videoModels || provider.video_models || current.videoModels, '');
    const model = normalizeAiImageOptionalModelName(provider.model || draftImageModels[0] || draftChatModels[0] || draftVideoModels[0] || '');
    const selectedModelGroup = inferAiImageModelGroupFromLists(draftImageModels, draftChatModels, draftVideoModels);
    const {
        modelGroup,
        imageModels,
        chatModels,
        videoModels
    } = scopeAiImageModelsByGroup(selectedModelGroup, draftImageModels, draftChatModels, draftVideoModels);
    const detectedImageModels = mergeAiImageModelCandidates(detectedImageModelsInput?.value, provider.detectedImageModels, imageModels);
    const detectedChatModels = mergeAiImageModelCandidates(detectedChatModelsInput?.value, provider.detectedChatModels, chatModels);
    const detectedVideoModels = mergeAiImageModelCandidates(detectedVideoModelsInput?.value, provider.detectedVideoModels, videoModels);
    const detectedUnknownModels = mergeAiImageModelCandidates(detectedUnknownModelsInput?.value, provider.detectedUnknownModels);
    const visionModels = mergeAiImageModelCandidates(visionModelsInput?.value, provider.visionModels, provider.vision_models);
    const vendor = normalizeAiImageModelVendor(vendorInput?.value || provider.vendor || current.vendor || DEFAULT_AI_IMAGE_MODEL_CONFIG.vendor);
    const vendorLabel = isAiImageCustomVendor(vendor)
        ? normalizeAiImageModelVendorLabel(vendorLabelInput?.value || provider.vendorLabel || provider.vendor_label || current.vendorLabel || current.vendor_label)
        : '';

    return {
        providerId: normalizeAiImageProviderId(providerIdInput?.value || provider.providerId || current.providerId || 'default'),
        label: String(providerLabelInput?.value || provider.label || current.label || '').trim().slice(0, 120),
        vendor,
        vendorLabel,
        vendor_label: vendorLabel,
        protocol: normalizeAiImageModelProtocol(protocolInput?.value || provider.protocol || current.protocol || DEFAULT_AI_IMAGE_MODEL_CONFIG.protocol),
        modelGroup,
        model_group: modelGroup,
        baseUrl: normalizeAiImageModelBaseUrl(baseUrlInput?.value || provider.baseUrl || current.baseUrl || DEFAULT_AI_IMAGE_MODEL_CONFIG.baseUrl),
        model,
        models: imageModels,
        imageModels,
        image_models: imageModels,
        chatModels,
        chat_models: chatModels,
        videoModels,
        video_models: videoModels,
        detectedImageModels,
        detected_image_models: detectedImageModels,
        detectedChatModels,
        detected_chat_models: detectedChatModels,
        detectedVideoModels,
        detected_video_models: detectedVideoModels,
        detectedUnknownModels,
        detected_unknown_models: detectedUnknownModels,
        visionModels,
        vision_models: visionModels
    };
}

function validateAiImageModelDraftConfig(config = {}) {
    const baseUrl = normalizeAiImageModelBaseUrl(config.baseUrl);

    if (!/^https?:\/\//i.test(baseUrl)) {
        return '请输入有效的 AI 图片 Base URL，例如 https://api.openai.com/v1';
    }

    if (!normalizeAiImageProviderId(config.providerId)) {
        return '请输入有效的供应商 ID，例如 default、flux 或 eahe';
    }

    if (isAiImageCustomVendor(config.vendor) && !normalizeAiImageModelVendorLabel(config.vendorLabel || config.vendor_label)) {
        return '请输入自定义模型厂商名称，例如 OpenRouter / 火山方舟';
    }

    return '';
}

async function postAiImageModelConfig(payload = {}) {
    const headers = await getAdminApiHeaders();
    const response = await (window.AdminApi?.fetch || fetch)(getAiImageModelConfigUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (payload?.matrix === true && data?.check && typeof data.check === 'object') {
        return data;
    }
    if (!response.ok || !data.success) {
        throw new Error(data.message || '保存 AI 图片模型配置失败');
    }
    return data;
}

function selectAiImageModelProvider(providerId = '') {
    const normalizedProviderId = normalizeAiImageProviderId(providerId);
    const draftProviderId = normalizeAiImageProviderId(adminAiImageState.modelProviderDraft?.providerId || adminAiImageState.modelProviderDraft?.provider_id || '');
    adminAiImageState.selectedModelProviderId = normalizedProviderId;
    if (normalizedProviderId) {
        adminAiImageState.modelProviderPanelState[normalizedProviderId] = true;
    }
    if (!draftProviderId || draftProviderId !== normalizedProviderId) {
        clearAiImageEditingModelProviderDraft();
    }
    renderAiImageModelConfigPanel();
    return true;
}

function toggleAiImageModelProviderModels(providerId = '') {
    const normalizedProviderId = normalizeAiImageProviderId(providerId);
    return selectAiImageModelProvider(normalizedProviderId);
}

function createAiImageModelProviderDraft() {
    adminAiImageState.selectedModelProviderId = '';
    setAiImageModelProbe(null);
    adminAiImageState.modelProviderDraft = createEmptyAiImageModelProviderDraft();
    renderAiImageModelConfigPanel();
    const labelInput = document.getElementById('aiImageModelProviderLabelInput');
    if (labelInput && typeof labelInput.focus === 'function') {
        labelInput.focus();
        if (typeof labelInput.select === 'function') {
            labelInput.select();
        }
    }
    showAdminStudioToast('已新建上游草稿：填写名称、Base URL 并录入 Key 后即可检测模型。', 'info');
    return adminAiImageState.modelProviderDraft;
}

function handleAiImageModelProviderDraftInput(target) {
    if (!target) return false;
    const updates = {};
    if (target.id === 'aiImageModelProviderLabelInput') {
        updates.label = String(target.value || '').trim().slice(0, 120);
    } else if (target.id === 'aiImageModelBaseUrlInput') {
        updates.baseUrl = normalizeAiImageModelBaseUrl(target.value || '');
    } else if (target.id === 'aiImageModelVendorInput') {
        updates.vendor = normalizeAiImageModelVendor(target.value || 'openai');
        if (isAiImageCustomVendor(updates.vendor)) {
            const vendorLabelInput = document.getElementById('aiImageModelVendorLabelInput');
            updates.vendorLabel = normalizeAiImageModelVendorLabel(vendorLabelInput?.value || '');
            updates.vendor_label = updates.vendorLabel;
            syncAiImageModelVendorCustomField(updates.vendor, { focus: true });
        } else {
            updates.vendorLabel = '';
            updates.vendor_label = '';
            syncAiImageModelVendorCustomField(updates.vendor);
        }
    } else if (target.id === 'aiImageModelVendorLabelInput') {
        updates.vendorLabel = normalizeAiImageModelVendorLabel(target.value || '');
        updates.vendor_label = updates.vendorLabel;
    } else if (target.id === 'aiImageModelProtocolInput') {
        updates.protocol = normalizeAiImageModelProtocol(target.value || 'openai-compatible');
    } else {
        return false;
    }
    setAiImageEditingModelProviderDraft(updates);
    return true;
}

function toggleAiImageVisibleModel(model = '', group = 'image', providerId = '') {
    const normalizedModel = normalizeAiImageOptionalModelName(model);
    const rawGroup = String(group || '').trim().toLowerCase();
    const normalizedGroup = ['chat', 'image', 'video'].includes(rawGroup) ? rawGroup : 'image';
    if (!normalizedModel) return false;

    const config = getAiImageModelConfig();
    const providers = getAiImageModelProviders(config);
    const normalizedProviderId = normalizeAiImageProviderId(providerId || adminAiImageState.selectedModelProviderId || config.providerId || 'default');
    const hasDraft = adminAiImageState.modelProviderDraft
        && normalizeAiImageProviderId(adminAiImageState.modelProviderDraft.providerId || adminAiImageState.modelProviderDraft.provider_id || '') === normalizedProviderId;
    const provider = hasDraft
        ? normalizeAiImageModelProvider(adminAiImageState.modelProviderDraft)
        : (providers.find((item) => item.providerId === normalizedProviderId) || getAiImageEditingModelProvider(config));
    const targetKey = normalizedGroup === 'chat' ? 'chatModels' : (normalizedGroup === 'video' ? 'videoModels' : 'imageModels');
    const selected = normalizeAiImageModelsList(provider[targetKey], '');
    const exists = selected.some((item) => item.toLowerCase() === normalizedModel.toLowerCase());
    const nextSelected = exists
        ? selected.filter((item) => item.toLowerCase() !== normalizedModel.toLowerCase())
        : normalizeAiImageModelsList([...selected, normalizedModel], '');
    const updates = {
        [targetKey]: nextSelected,
        [`${targetKey === 'chatModels' ? 'chat_models' : (targetKey === 'videoModels' ? 'video_models' : 'image_models')}`]: nextSelected
    };
    if (normalizedGroup === 'chat') {
        updates.detectedChatModels = mergeAiImageModelCandidates(provider.detectedChatModels, normalizedModel);
    } else if (normalizedGroup === 'video') {
        updates.detectedVideoModels = mergeAiImageModelCandidates(provider.detectedVideoModels, normalizedModel);
    } else {
        updates.detectedImageModels = mergeAiImageModelCandidates(provider.detectedImageModels, normalizedModel);
    }
    updates.model = updates.imageModels?.[0] || provider.imageModels?.[0] || updates.chatModels?.[0] || provider.chatModels?.[0] || updates.videoModels?.[0] || provider.videoModels?.[0] || provider.model || '';
    updates.modelGroup = inferAiImageModelGroupFromLists(
        normalizedGroup === 'image' ? nextSelected : provider.imageModels,
        normalizedGroup === 'chat' ? nextSelected : provider.chatModels,
        normalizedGroup === 'video' ? nextSelected : provider.videoModels
    );
    updates.model_group = updates.modelGroup;
    if (hasDraft) {
        adminAiImageState.selectedModelProviderId = normalizedProviderId;
        setAiImageEditingModelProviderDraft(updates);
        setAiImageHiddenModelInputValues(adminAiImageState.modelProviderDraft);
    } else {
        const nextProvider = normalizeAiImageModelProvider({
            ...provider,
            ...updates
        });
        const nextProviders = providers.map((item) => item.providerId === normalizedProviderId ? nextProvider : item);
        setAiImageModelConfig({
            ...config,
            providerId: normalizedProviderId,
            providers: nextProviders
        });
        adminAiImageState.selectedModelProviderId = normalizedProviderId;
    }
    renderAiImageModelConfigPanel();
    return true;
}

function cloneAiImageModelProvider(providerId = '') {
    const config = getAiImageModelConfig();
    const providers = getAiImageModelProviders(config);
    const sourceProvider = providers.find((item) => item.providerId === normalizeAiImageProviderId(providerId))
        || getSelectedAiImageModelProvider(config);
    if (!sourceProvider) {
        return false;
    }

    selectAiImageModelProvider(sourceProvider.providerId);

    const providerIdInput = document.getElementById('aiImageModelProviderIdInput');
    const suggestedProviderId = buildAiImageProviderIdSuggestion(sourceProvider.providerId, sourceProvider.modelGroup, providers);
    if (providerIdInput) {
        providerIdInput.value = suggestedProviderId;
        providerIdInput.dataset.adminProviderIdDirty = '1';
        if (typeof providerIdInput.focus === 'function') {
            providerIdInput.focus();
        }
        if (typeof providerIdInput.select === 'function') {
            providerIdInput.select();
        }
    }

    showAdminStudioToast(`已生成新的供应商 ID：${suggestedProviderId}，保存后会作为独立上游。`, 'info');
    return true;
}

function getAiImageProviderDraftForAction(providerId = '') {
    const config = getAiImageModelConfig();
    const normalizedProviderId = normalizeAiImageProviderId(providerId || adminAiImageState.selectedModelProviderId || config.providerId || 'default');
    const provider = getAiImageModelProviders(config).find((item) => item.providerId === normalizedProviderId)
        || getSelectedAiImageModelProvider(config);
    const formDraft = readAiImageModelDraftConfig();
    const formDraftProviderId = normalizeAiImageProviderId(formDraft.providerId || formDraft.provider_id || '');
    const draft = formDraftProviderId === normalizedProviderId
        ? formDraft
        : (provider?.providerId === normalizedProviderId
        ? normalizeAiImageModelProvider(provider)
        : formDraft);
    return {
        config,
        provider,
        draft: {
            ...draft,
            providerId: normalizeAiImageProviderId(draft.providerId || draft.provider_id || normalizedProviderId),
            provider_id: normalizeAiImageProviderId(draft.providerId || draft.provider_id || normalizedProviderId)
        }
    };
}

function updateAiImageModelProviderInConfig(providerId = '', updates = {}) {
    const normalizedProviderId = normalizeAiImageProviderId(providerId);
    const config = getAiImageModelConfig();
    const providers = getAiImageModelProviders(config);
    const nextProviders = providers.map((item) => {
        if (item.providerId !== normalizedProviderId) return item;
        return normalizeAiImageModelProvider({
            ...item,
            ...(updates && typeof updates === 'object' ? updates : {})
        });
    });
    setAiImageModelConfig({
        ...config,
        providerId: normalizedProviderId,
        providers: nextProviders
    });
    adminAiImageState.selectedModelProviderId = normalizedProviderId;
    adminAiImageState.modelProviderPanelState[normalizedProviderId] = true;
    return getAiImageModelProviders(getAiImageModelConfig()).find((item) => item.providerId === normalizedProviderId);
}

async function testAiImageModelConfig(providerId = '') {
    const { draft, provider } = providerId
        ? getAiImageProviderDraftForAction(providerId)
        : { draft: readAiImageModelDraftConfig(), provider: null };
    const validationMessage = validateAiImageModelDraftConfig(draft);
    if (validationMessage) {
        showAdminStudioToast(validationMessage, 'warning');
        return false;
    }
    if (!normalizeAiImageModelsList(draft.imageModels || draft.image_models, '').length
        && !normalizeAiImageModelsList(draft.chatModels || draft.chat_models, '').length
        && !normalizeAiImageModelsList(draft.videoModels || draft.video_models, '').length) {
        showAdminStudioToast('请先检测并勾选至少一个前台可见模型，再运行模型可用性自检。', 'warning');
        return false;
    }

    const actionProvider = provider || getAiImageModelProviders(getAiImageModelConfig()).find((item) => item.providerId === draft.providerId);
    if (!actionProvider?.configured) {
        showAdminStudioToast('请先录入并保存 AI 图片 API Key，再运行模型自检。', 'warning');
        setAiImageModelProbe({
            ok: false,
            providerId: draft.providerId,
            providerLabel: draft.label || actionProvider?.label || draft.providerId,
            message: '未配置后台模型 Key'
        });
        renderAiImageModelConfigPanel();
        return false;
    }

    setAiImageModelProbe({
        pending: true,
        ok: false,
        providerId: draft.providerId,
        providerLabel: draft.label || actionProvider.label || draft.providerId,
        model: draft.model
    });
    renderAiImageModelConfigPanel();

    try {
        const probeModes = draft.modelGroup === 'chat'
            ? ['chat', 'vision']
            : (draft.modelGroup === 'video' ? [] : (draft.modelGroup === 'both' ? ['text', 'image', 'chat', 'vision'] : ['text', 'image']));
        showAdminStudioToast('正在运行 AI 图片模型可用性自检...', 'info');
        const payload = await postAiImageModelConfig({
            action: 'test-model',
            matrix: true,
            discoverModels: true,
            modes: probeModes,
            resolutions: ['1k', '2k', '4k'],
            ...draft
        });
        const check = payload.check && typeof payload.check === 'object' ? payload.check : {};
        const nextVisionModels = mergeAiImageModelCandidates(
            draft.visionModels,
            draft.vision_models,
            check.visionModels,
            check.vision_models
        );
        if (nextVisionModels.length) {
            const nextDraft = {
                ...draft,
                visionModels: nextVisionModels,
                vision_models: nextVisionModels
            };
            updateAiImageModelProviderInConfig(draft.providerId, nextDraft);
            setAiImageHiddenModelInputValues(nextDraft);
        }
        setAiImageModelProbe({
            ok: check.ok !== false,
            providerId: draft.providerId,
            providerLabel: draft.label || actionProvider.label || draft.providerId,
            model: check.model || draft.model,
            resultType: check.resultType || '',
            latencyMs: check.latencyMs || 0,
            passed: Number(check.passed || 0),
            failed: Number(check.failed || 0),
            total: Number(check.total || 0),
            checks: Array.isArray(check.checks) ? check.checks : [],
            visionModels: nextVisionModels,
            vision_models: nextVisionModels,
            discovery: check.discovery && typeof check.discovery === 'object' ? check.discovery : null,
            modelPresence: check.modelPresence && typeof check.modelPresence === 'object' ? check.modelPresence : null
        });
        renderAiImageModelConfigPanel();
        showAdminStudioToast(payload.message || 'AI 图片模型可用性自检完成', check.ok === false ? 'warning' : 'success');
        return check.ok !== false;
    } catch (err) {
        console.error('AI image model availability check failed:', err);
        setAiImageModelProbe({
            ok: false,
            providerId: draft.providerId,
            providerLabel: draft.label || actionProvider?.label || draft.providerId,
            model: draft.model,
            message: err.message || '模型可用性自检失败'
        });
        renderAiImageModelConfigPanel();
        showAdminStudioToast(err.message || 'AI 图片模型可用性自检失败', 'error');
        return false;
    }
}

async function discoverAiImageModelConfig(providerId = '') {
    const action = providerId
        ? getAiImageProviderDraftForAction(providerId)
        : null;
    const config = action?.config || getAiImageModelConfig();
    const provider = action?.provider
        || getAiImageModelProviders(config).find((item) => item.providerId === readAiImageModelDraftConfig().providerId)
        || getSelectedAiImageModelProvider(config);
    const draft = providerId
        ? action.draft
        : ensureAiImageProviderIdForDraft(readAiImageModelDraftConfig(), provider, config);
    if (!draft) {
        return false;
    }

    if (!normalizeAiImageModelBaseUrl(draft.baseUrl)) {
        showAdminStudioToast('请先填写有效的 Base URL，再检测上游模型。', 'warning');
        return false;
    }

    if (!provider?.configured) {
        showAdminStudioToast('请先录入并保存 AI 图片 API Key，再检测上游支持模型。', 'warning');
        setAiImageModelProbe({
            ok: false,
            discoveryOnly: true,
            providerId: draft.providerId,
            providerLabel: draft.label || provider?.label || draft.providerId,
            baseUrl: draft.baseUrl,
            message: '未配置后台模型 Key'
        });
        renderAiImageModelConfigPanel();
        return false;
    }

    setAiImageModelProbe({
        pending: true,
        ok: false,
        discoveryOnly: true,
        providerId: draft.providerId,
        providerLabel: draft.label || provider.label || draft.providerId,
        baseUrl: draft.baseUrl,
        model: draft.model
    });
    renderAiImageModelConfigPanel();

    try {
        showAdminStudioToast('正在检测上游支持的模型...', 'info');
        const payload = await postAiImageModelConfig({
            action: 'discover-models',
            providerId: draft.providerId,
            baseUrl: draft.baseUrl,
            timeoutMs: 30000
        });
        const discovery = payload.discovery && typeof payload.discovery === 'object' ? payload.discovery : {};
        const imageModels = normalizeAiImageModelsList(discovery.imageModels || discovery.image_models, '');
        const chatModels = normalizeAiImageModelsList(discovery.chatModels || discovery.chat_models, '');
        const videoModels = normalizeAiImageModelsList(discovery.videoModels || discovery.video_models, '');
        const detectedCount = imageModels.length + chatModels.length + videoModels.length;
        if (!detectedCount) {
            setAiImageModelProbe({
                ok: false,
                discoveryOnly: true,
                providerId: draft.providerId,
                providerLabel: draft.label || provider.label || draft.providerId,
                baseUrl: draft.baseUrl,
                discovery,
                message: '未发现可用于生图、对话或视频的模型'
            });
            renderAiImageModelConfigPanel();
            showAdminStudioToast('检测完成，但没有发现可用于生图、对话或视频的模型。', 'warning');
            return false;
        }

        const nextImageModels = imageModels;
        const nextChatModels = chatModels;
        const nextVideoModels = videoModels;
        const nextModelGroup = inferAiImageModelGroupFromLists(nextImageModels, nextChatModels, nextVideoModels);
        const nextModel = nextImageModels[0] || nextChatModels[0] || nextVideoModels[0] || '';
        const nextDraft = {
            ...draft,
            modelGroup: nextModelGroup,
            model_group: nextModelGroup,
            model: nextModel,
            models: nextImageModels,
            imageModels: nextImageModels,
            image_models: nextImageModels,
            chatModels: nextChatModels,
            chat_models: nextChatModels,
            videoModels: nextVideoModels,
            video_models: nextVideoModels,
            detectedImageModels: nextImageModels,
            detected_image_models: nextImageModels,
            detectedChatModels: nextChatModels,
            detected_chat_models: nextChatModels,
            detectedVideoModels: nextVideoModels,
            detected_video_models: nextVideoModels,
            detectedUnknownModels: normalizeAiImageModelsList(discovery.unknownModels || discovery.unknown_models, ''),
            detected_unknown_models: normalizeAiImageModelsList(discovery.unknownModels || discovery.unknown_models, '')
        };
        if (providerId) {
            updateAiImageModelProviderInConfig(nextDraft.providerId, nextDraft);
        } else {
            setAiImageEditingModelProviderDraft(nextDraft);
            adminAiImageState.selectedModelProviderId = nextDraft.providerId;
        }
        setAiImageModelProbe({
            ok: true,
            discoveryOnly: true,
            providerId: nextDraft.providerId,
            providerLabel: nextDraft.label || provider.label || nextDraft.providerId,
            baseUrl: nextDraft.baseUrl,
            model: nextDraft.model,
            discovery,
            imageModels: nextImageModels,
            chatModels: nextChatModels,
            videoModels: nextVideoModels
        });
        renderAiImageModelConfigPanel();
        showAdminStudioToast(`已检测到 ${detectedCount} 个上游模型。请勾选前台可见模型并保存。`, 'success');
        return true;
    } catch (err) {
        console.error('AI image model discovery failed:', err);
        setAiImageModelProbe({
            ok: false,
            discoveryOnly: true,
            providerId: draft.providerId,
            providerLabel: draft.label || provider.label || draft.providerId,
            baseUrl: draft.baseUrl,
            model: draft.model,
            message: err.message || '检测上游模型失败'
        });
        renderAiImageModelConfigPanel();
        showAdminStudioToast(err.message || '检测上游模型失败', 'error');
        return false;
    }
}

function applyAiImageDiscoveredModel(model = '', group = 'unknown', providerId = '') {
    const normalizedModel = normalizeAiImageModelName(model);
    const rawGroup = String(group || '').trim().toLowerCase();
    const normalizedGroup = ['chat', 'image', 'video', 'unknown'].includes(rawGroup) ? rawGroup : 'image';
    if (!normalizedModel) return false;

    return toggleAiImageVisibleModel(normalizedModel, normalizedGroup === 'unknown' ? 'image' : normalizedGroup, providerId);
}

function classifyAiImageUnknownModel(model = '', group = 'image', providerId = '') {
    const normalizedModel = normalizeAiImageOptionalModelName(model);
    const rawGroup = String(group || '').trim().toLowerCase();
    const normalizedGroup = ['chat', 'image', 'video'].includes(rawGroup) ? rawGroup : 'image';
    if (!normalizedModel) return false;

    const config = getAiImageModelConfig();
    const providers = getAiImageModelProviders(config);
    const normalizedProviderId = normalizeAiImageProviderId(providerId || adminAiImageState.selectedModelProviderId || config.providerId || 'default');
    const hasDraft = adminAiImageState.modelProviderDraft
        && normalizeAiImageProviderId(adminAiImageState.modelProviderDraft.providerId || adminAiImageState.modelProviderDraft.provider_id || '') === normalizedProviderId;
    const provider = hasDraft
        ? normalizeAiImageModelProvider(adminAiImageState.modelProviderDraft)
        : (providers.find((item) => item.providerId === normalizedProviderId) || getAiImageEditingModelProvider(config));
    const nextImageModels = normalizedGroup === 'image'
        ? mergeAiImageModelCandidates(provider.imageModels, normalizedModel)
        : removeAiImageModelCandidate(provider.imageModels, normalizedModel);
    const nextChatModels = normalizedGroup === 'chat'
        ? mergeAiImageModelCandidates(provider.chatModels, normalizedModel)
        : removeAiImageModelCandidate(provider.chatModels, normalizedModel);
    const nextVideoModels = normalizedGroup === 'video'
        ? mergeAiImageModelCandidates(provider.videoModels, normalizedModel)
        : removeAiImageModelCandidate(provider.videoModels, normalizedModel);
    const nextDetectedImageModels = normalizedGroup === 'image'
        ? mergeAiImageModelCandidates(provider.detectedImageModels, normalizedModel)
        : removeAiImageModelCandidate(provider.detectedImageModels, normalizedModel);
    const nextDetectedChatModels = normalizedGroup === 'chat'
        ? mergeAiImageModelCandidates(provider.detectedChatModels, normalizedModel)
        : removeAiImageModelCandidate(provider.detectedChatModels, normalizedModel);
    const nextDetectedVideoModels = normalizedGroup === 'video'
        ? mergeAiImageModelCandidates(provider.detectedVideoModels, normalizedModel)
        : removeAiImageModelCandidate(provider.detectedVideoModels, normalizedModel);
    const nextDetectedUnknownModels = removeAiImageModelCandidate(provider.detectedUnknownModels || provider.detected_unknown_models, normalizedModel);
    const nextModelGroup = inferAiImageModelGroupFromLists(nextImageModels, nextChatModels, nextVideoModels);
    const updates = {
        imageModels: nextImageModels,
        image_models: nextImageModels,
        models: nextImageModels,
        chatModels: nextChatModels,
        chat_models: nextChatModels,
        videoModels: nextVideoModels,
        video_models: nextVideoModels,
        detectedImageModels: nextDetectedImageModels,
        detected_image_models: nextDetectedImageModels,
        detectedChatModels: nextDetectedChatModels,
        detected_chat_models: nextDetectedChatModels,
        detectedVideoModels: nextDetectedVideoModels,
        detected_video_models: nextDetectedVideoModels,
        detectedUnknownModels: nextDetectedUnknownModels,
        detected_unknown_models: nextDetectedUnknownModels,
        model: nextImageModels[0] || nextChatModels[0] || nextVideoModels[0] || provider.model || '',
        modelGroup: nextModelGroup,
        model_group: nextModelGroup
    };

    if (hasDraft) {
        adminAiImageState.selectedModelProviderId = normalizedProviderId;
        setAiImageEditingModelProviderDraft(updates);
        setAiImageHiddenModelInputValues(adminAiImageState.modelProviderDraft);
    } else {
        const nextProvider = normalizeAiImageModelProvider({
            ...provider,
            ...updates
        });
        setAiImageModelConfig({
            ...config,
            providerId: normalizedProviderId,
            providers: providers.map((item) => item.providerId === normalizedProviderId ? nextProvider : item)
        });
        adminAiImageState.selectedModelProviderId = normalizedProviderId;
    }

    renderAiImageModelConfigPanel();
    const groupLabel = normalizedGroup === 'chat' ? '文本' : (normalizedGroup === 'video' ? '视频' : '生图');
    showAdminStudioToast(`已将 ${normalizedModel} 设为${groupLabel}模型，保存后前台可见。`, 'success');
    return true;
}

function buildAiImageProviderIdSuggestion(providerId = 'default', modelGroup = 'image', existingProviders = []) {
    const baseId = normalizeAiImageProviderId(providerId || 'default');
    const group = normalizeAiImageModelGroup(modelGroup, 'image');
    const existingIds = new Set(
        (Array.isArray(existingProviders) ? existingProviders : [])
            .map((item) => normalizeAiImageProviderId(item?.providerId || item?.provider_id || item?.id))
            .filter(Boolean)
    );
    const candidates = [];
    if (baseId) {
        candidates.push(`${baseId}-${group}`);
        candidates.push(`${baseId}_${group}`);
        candidates.push(`${group}-${baseId}`);
    }
    for (const candidate of candidates) {
        const normalized = normalizeAiImageProviderId(candidate);
        if (normalized && !existingIds.has(normalized)) {
            return normalized;
        }
    }
    let index = 2;
    while (index < 100) {
        const candidate = normalizeAiImageProviderId(`${baseId}-${group}-${index}`);
        if (candidate && !existingIds.has(candidate)) {
            return candidate;
        }
        index += 1;
    }
    return `${baseId}-${group}`;
}

function ensureAiImageProviderIdForDraft(draft = {}, provider = null, config = getAiImageModelConfig()) {
    const normalizedDraft = draft && typeof draft === 'object' && !Array.isArray(draft) ? { ...draft } : {};
    const currentProvider = provider && typeof provider === 'object' ? provider : null;
    if (!currentProvider || (currentProvider.source || 'missing') !== 'stored') {
        return normalizedDraft;
    }

    const currentGroup = normalizeAiImageModelGroup(currentProvider.modelGroup || currentProvider.model_group || '', 'image');
    const nextGroup = normalizeAiImageModelGroup(normalizedDraft.modelGroup || normalizedDraft.model_group || currentGroup, currentGroup);
    const currentProviderId = normalizeAiImageProviderId(currentProvider.providerId || currentProvider.provider_id || 'default');
    const draftProviderId = normalizeAiImageProviderId(normalizedDraft.providerId || normalizedDraft.provider_id || currentProviderId);
    if (currentProviderId !== draftProviderId || nextGroup === 'both' || currentGroup === nextGroup) {
        normalizedDraft.providerId = draftProviderId;
        normalizedDraft.provider_id = draftProviderId;
        return normalizedDraft;
    }

    const suggestion = buildAiImageProviderIdSuggestion(draftProviderId, nextGroup, getAiImageModelProviders(config));
    const nextProviderId = window.prompt(
        `当前「${currentProvider.label || currentProviderId}」已保存为 ${currentGroup === 'chat' ? '对话 / 视觉模型' : '生图模型'}。为了避免覆盖现有配置，请输入新的供应商 ID：`,
        suggestion
    );
    if (nextProviderId === null) {
        return null;
    }

    const normalizedNextProviderId = normalizeAiImageProviderId(nextProviderId);
    if (!normalizedNextProviderId) {
        showAdminStudioToast('请输入有效的供应商 ID', 'warning');
        return null;
    }

    normalizedDraft.providerId = normalizedNextProviderId;
    normalizedDraft.provider_id = normalizedNextProviderId;

    const providerIdInput = document.getElementById('aiImageModelProviderIdInput');
    if (providerIdInput && document.activeElement !== providerIdInput) {
        providerIdInput.value = normalizedNextProviderId;
    }

    return normalizedDraft;
}

async function promptForAiImageModelKey(options = {}) {
    const provider = options.provider || getSelectedAiImageModelProvider(getAiImageModelConfig());
    const draft = ensureAiImageProviderIdForDraft(
        options.draft || readAiImageModelDraftConfig(),
        provider,
        getAiImageModelConfig()
    );
    if (!draft) {
        return false;
    }
    const validationMessage = validateAiImageModelDraftConfig(draft);
    if (validationMessage) {
        showAdminStudioToast(validationMessage, 'warning');
        return false;
    }

    const config = getAiImageModelConfig();
    const targetProvider = getAiImageModelProviders(config).find((item) => item.providerId === draft.providerId)
        || provider
        || getSelectedAiImageModelProvider(config);
    const meta = getAiImageModelSourceMeta(config);
    const helperText = options.helperText || (
        targetProvider.source === 'stored'
            ? '输入新的 AI 图片 API Key 将覆盖当前后台安全存储的 Key。'
            : (meta.source === 'environment'
                ? '当前使用的是环境变量。录入后会优先使用后台安全存储版本。'
                : '首次保存 AI 图片模型配置需要同时录入 API Key，提交后会由服务端加密保存。')
    );
    const input = window.prompt(`${helperText}\n\n请输入 AI 图片 / OpenAI 兼容 Images API Key：`, '');
    if (input === null) return null;

    const apiKey = String(input || '').trim();
    if (!apiKey) {
        showAdminStudioToast('未输入 AI 图片 API Key', 'warning');
        return false;
    }

    try {
        showAdminStudioToast('正在安全保存 AI 图片模型配置...', 'info');
        const payload = await postAiImageModelConfig({
            apiKey,
            ...draft
        });
        setAiImageModelConfig(payload);
        clearAiImageEditingModelProviderDraft();
        renderAiImageModelConfigPanel();
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast(payload.message || 'AI 图片模型配置已安全保存。', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save AI image model key:', err);
        showAdminStudioToast(err.message || '保存 AI 图片模型配置失败', 'error');
        return false;
    }
}

async function saveAiImageModelConfig() {
    const config = getAiImageModelConfig();
    const draftConfig = readAiImageModelDraftConfig();
    const provider = getAiImageModelProviders(config).find((item) => item.providerId === draftConfig.providerId)
        || getAiImageEditingModelProvider(config);
    const draft = ensureAiImageProviderIdForDraft(draftConfig, provider, config);
    if (!draft) {
        return false;
    }
    const validationMessage = validateAiImageModelDraftConfig(draft);
    if (validationMessage) {
        showAdminStudioToast(validationMessage, 'warning');
        return false;
    }

    if ((provider.source || 'missing') !== 'stored') {
        return promptForAiImageModelKey({
            draft,
            provider,
            helperText: `首次固化「${provider.label || draft.label || draft.providerId}」供应商时，需要同时录入 API Key。后续只切换 Base URL 或模型名，可以直接保存配置。`
        });
    }

    try {
        showAdminStudioToast('正在保存 AI 图片模型配置...', 'info');
        const payload = await postAiImageModelConfig(draft);
        setAiImageModelConfig(payload);
        clearAiImageEditingModelProviderDraft();
        renderAiImageModelConfigPanel();
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast(payload.message || 'AI 图片模型配置已更新。', 'success');
        return true;
    } catch (err) {
        console.error('Failed to update AI image model config:', err);
        showAdminStudioToast(err.message || '保存 AI 图片模型配置失败', 'error');
        return false;
    }
}

async function deleteAiImageModelConfig(providerId = '') {
    const config = getAiImageModelConfig();
    const normalizedProviderId = normalizeAiImageProviderId(providerId);
    const providers = getAiImageModelProviders(config);
    const provider = normalizedProviderId
        ? (providers.find((item) => item.providerId === normalizedProviderId) || getSelectedAiImageModelProvider(config))
        : getSelectedAiImageModelProvider(config);
    if ((provider.source || 'missing') !== 'stored') {
        showAdminStudioToast('当前没有可删除的后台存储 AI 图片模型配置。', 'info');
        return null;
    }

    if (!confirm(`确定要删除「${provider.label || provider.providerId}」后台安全存储的 AI 图片模型配置吗？`)) {
        return null;
    }

    try {
        const headers = await getAdminApiHeaders();
        const deleteUrl = `${getAiImageModelConfigUrl()}&providerId=${encodeURIComponent(provider.providerId)}`;
        const response = await (window.AdminApi?.fetch || fetch)(deleteUrl, {
            method: 'DELETE',
            headers
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '删除 AI 图片模型配置失败');
        }

        setAiImageModelConfig(payload);
        renderAiImageModelConfigPanel();
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast(payload.message || 'AI 图片模型配置已删除', 'success');
        return true;
    } catch (err) {
        console.error('Failed to delete AI image model config:', err);
        showAdminStudioToast(err.message || '删除 AI 图片模型配置失败', 'error');
        return false;
    }
}

function normalizeAiImagePricingMode(value = 'text') {
    const normalized = String(value || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(AI_IMAGE_PRICING_MODE_ALIASES, normalized)) {
        return AI_IMAGE_PRICING_MODE_ALIASES[normalized];
    }
    return Object.prototype.hasOwnProperty.call(AI_IMAGE_PRICING_MODE_LABELS, normalized) ? normalized : 'text';
}

function normalizeAiImagePricingStrategy(value = 'per_request') {
    const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    return Object.prototype.hasOwnProperty.call(AI_IMAGE_PRICING_STRATEGY_LABELS, normalized) ? normalized : 'per_request';
}

function getAiImagePricingModeLabel(mode = 'text') {
    return AI_IMAGE_PRICING_MODE_LABELS[normalizeAiImagePricingMode(mode)] || mode || '规则';
}

function getAiImagePricingStrategyLabel(strategy = 'per_request') {
    return AI_IMAGE_PRICING_STRATEGY_LABELS[normalizeAiImagePricingStrategy(strategy)] || '按次 / 张';
}

function getAiImagePricingMetadata(rule = {}) {
    return rule.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
        ? rule.metadata
        : {};
}

function getAiImagePricingStrategy(rule = {}) {
    const metadata = getAiImagePricingMetadata(rule);
    return normalizeAiImagePricingStrategy(
        metadata.billing_strategy
        || metadata.billingStrategy
        || metadata.pricing?.billing_strategy
        || metadata.pricing?.billingStrategy
        || (rule.mode === 'chat' || rule.mode === 'reverse' ? 'token_sub2api' : 'per_request')
    );
}

function normalizeAiImagePricingProviderValue(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw === '*' || raw.toLowerCase() === 'all') return '*';
    return normalizeAiImageProviderId(raw);
}

function getAiImagePricingProviderId(rule = {}) {
    const metadata = getAiImagePricingMetadata(rule);
    const pricing = metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
        ? metadata.pricing
        : {};
    return normalizeAiImagePricingProviderValue(
        metadata.provider_id
        || metadata.providerId
        || pricing.provider_id
        || pricing.providerId
        || rule.provider_id
        || rule.providerId
        || ''
    );
}

function getAiImagePricingProviderLabel(providerId = '') {
    const normalizedProviderId = normalizeAiImagePricingProviderValue(providerId);
    if (normalizedProviderId === '*') return '全部上游';
    const provider = getAiImageModelProviders(getAiImageModelConfig())
        .find((item) => normalizeAiImageProviderId(item.providerId || item.provider_id || '') === normalizedProviderId);
    return provider?.label || provider?.providerId || normalizedProviderId || '';
}

function normalizeAiImagePricingNumber(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER, precision = 6 } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const factor = 10 ** Math.max(0, Number(precision) || 0);
    return Math.min(max, Math.max(min, Math.round(parsed * factor) / factor));
}

function normalizeAiImagePricingInt(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function getAiImagePricingEstimateDefaults(mode = 'text') {
    return {
        ...(AI_IMAGE_PRICING_DEFAULT_ESTIMATES[normalizeAiImagePricingMode(mode)] || AI_IMAGE_PRICING_DEFAULT_ESTIMATES.text)
    };
}

function getAiImagePricingTokenConfigFromRule(rule = {}) {
    const metadata = getAiImagePricingMetadata(rule);
    const pricing = metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
        ? metadata.pricing
        : {};
    const rates = pricing.rates && typeof pricing.rates === 'object' && !Array.isArray(pricing.rates)
        ? pricing.rates
        : {};
    const estimates = pricing.estimate && typeof pricing.estimate === 'object' && !Array.isArray(pricing.estimate)
        ? pricing.estimate
        : {};
    const defaultEstimates = getAiImagePricingEstimateDefaults(rule.mode);
    return {
        inputRate: normalizeAiImagePricingNumber(rates.input ?? rates.input_per_million ?? pricing.inputRate ?? pricing.input_rate, 0),
        outputRate: normalizeAiImagePricingNumber(rates.output ?? rates.output_per_million ?? pricing.outputRate ?? pricing.output_rate, 0),
        cacheWriteRate: normalizeAiImagePricingNumber(rates.cache_write ?? rates.cacheWrite ?? pricing.cacheWriteRate ?? pricing.cache_write_rate, 0),
        cacheReadRate: normalizeAiImagePricingNumber(rates.cache_read ?? rates.cacheRead ?? pricing.cacheReadRate ?? pricing.cache_read_rate, 0),
        imageOutputRate: normalizeAiImagePricingNumber(rates.image_output ?? rates.imageOutput ?? pricing.imageOutputRate ?? pricing.image_output_rate, 0),
        requestBase: normalizeAiImagePricingNumber(pricing.request_base ?? pricing.requestBase ?? pricing.per_request ?? pricing.perRequest, 0, { precision: 2 }),
        multiplier: normalizeAiImagePricingNumber(pricing.multiplier, 1, { min: 0, max: 1000, precision: 4 }) || 1,
        estimateInputTokens: normalizeAiImagePricingInt(estimates.input_tokens ?? estimates.inputTokens, defaultEstimates.input_tokens),
        estimateOutputTokens: normalizeAiImagePricingInt(estimates.output_tokens ?? estimates.outputTokens, defaultEstimates.output_tokens),
        estimateCacheWriteTokens: normalizeAiImagePricingInt(estimates.cache_write_tokens ?? estimates.cacheWriteTokens, defaultEstimates.cache_write_tokens),
        estimateCacheReadTokens: normalizeAiImagePricingInt(estimates.cache_read_tokens ?? estimates.cacheReadTokens, defaultEstimates.cache_read_tokens),
        estimateImageOutputTokens: normalizeAiImagePricingInt(estimates.image_output_tokens ?? estimates.imageOutputTokens, defaultEstimates.image_output_tokens)
    };
}

function calculateAiImagePricingTokenPoints(config = {}) {
    const input = normalizeAiImagePricingInt(config.estimateInputTokens, 0);
    const output = normalizeAiImagePricingInt(config.estimateOutputTokens, 0);
    const cacheWrite = normalizeAiImagePricingInt(config.estimateCacheWriteTokens, 0);
    const cacheRead = normalizeAiImagePricingInt(config.estimateCacheReadTokens, 0);
    const imageOutput = normalizeAiImagePricingInt(config.estimateImageOutputTokens, 0);
    const billableInput = Math.max(0, input - cacheRead);
    const billableOutput = Math.max(0, output - imageOutput);
    const base = normalizeAiImagePricingNumber(config.requestBase, 0, { precision: 6 });
    const multiplier = normalizeAiImagePricingNumber(config.multiplier, 1, { min: 0, max: 1000, precision: 6 }) || 1;
    const total = base
        + (billableInput * normalizeAiImagePricingNumber(config.inputRate, 0) / 1000000)
        + (billableOutput * normalizeAiImagePricingNumber(config.outputRate, 0) / 1000000)
        + (cacheWrite * normalizeAiImagePricingNumber(config.cacheWriteRate, 0) / 1000000)
        + (cacheRead * normalizeAiImagePricingNumber(config.cacheReadRate, 0) / 1000000)
        + (imageOutput * normalizeAiImagePricingNumber(config.imageOutputRate, 0) / 1000000);
    return normalizeAiImagePricingNumber(total * multiplier, 0, { precision: 6 });
}

function isAiImagePricingVisualMode(mode = 'text') {
    return ['text', 'image', 'agent', 'video'].includes(normalizeAiImagePricingMode(mode));
}

function isAiImagePricingQuantityMode(mode = 'text') {
    return ['text', 'image', 'agent'].includes(normalizeAiImagePricingMode(mode));
}

function isAiImagePricingImageOutputTokenMode(mode = 'text') {
    return ['text', 'image', 'agent'].includes(normalizeAiImagePricingMode(mode));
}

function getAiImagePricingProviderModels(provider = {}, mode = '') {
    const targetMode = normalizeAiImagePricingMode(mode);
    if (targetMode === 'chat') {
        return normalizeAiImageModelsList(provider.chatModels || provider.chat_models, '');
    }
    if (targetMode === 'reverse') {
        return mergeAiImageModelCandidates(provider.visionModels || provider.vision_models, provider.chatModels || provider.chat_models);
    }
    if (targetMode === 'video') {
        return normalizeAiImageModelsList(provider.videoModels || provider.video_models, '');
    }
    return normalizeAiImageModelsList(provider.imageModels || provider.image_models || provider.models, '');
}

function getAiImagePricingProviderOptions(mode = '') {
    const targetMode = normalizeAiImagePricingMode(mode || document.getElementById('aiImagePricingModeInput')?.value || 'text');
    return getAiImageModelProviders(getAiImageModelConfig())
        .filter((provider) => provider.isActive !== false && provider.is_active !== false)
        .map((provider) => ({
            provider,
            providerId: normalizeAiImageProviderId(provider.providerId || provider.provider_id || ''),
            label: provider.label || provider.providerId || '上游',
            models: getAiImagePricingProviderModels(provider, targetMode)
        }))
        .filter((item) => item.models.length);
}

function getAiImagePricingModelSelectOptions(mode = '', providerId = '') {
    const targetMode = normalizeAiImagePricingMode(mode || document.getElementById('aiImagePricingModeInput')?.value || 'text');
    const normalizedProviderId = normalizeAiImagePricingProviderValue(providerId || document.getElementById('aiImagePricingProviderInput')?.value || '');
    const providerOptions = getAiImagePricingProviderOptions(targetMode);
    const targetProviders = normalizedProviderId && normalizedProviderId !== '*'
        ? providerOptions.filter((item) => item.providerId === normalizedProviderId)
        : providerOptions;
    const seen = new Set();
    const options = [];
    targetProviders.forEach((item) => {
        item.models.forEach((model) => {
            const key = `${item.providerId}:${String(model || '').trim().toLowerCase()}`;
            if (!model || seen.has(key)) return;
            seen.add(key);
            options.push({
                value: model,
                label: model,
                providerId: item.providerId,
                providerLabel: item.label
            });
        });
    });
    return options;
}

function getAiImagePricingModelOptions(mode = '') {
    return getAiImagePricingModelSelectOptions(mode).map((item) => item.value);
}

function bindAiImagePricingDropdownOptions(dropdownId = '') {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');
    const options = dropdown.querySelectorAll('.select-option');
    options.forEach((option) => {
        if (option.dataset.aiImagePricingOptionBound === '1') return;
        option.dataset.aiImagePricingOptionBound = '1';
        option.addEventListener('click', () => {
            const value = option.dataset.value || '';
            const oldValue = hiddenInput?.value || '';
            if (hiddenInput) {
                hiddenInput.value = value;
                hiddenInput.dataset.adminDropdownDirty = '1';
            }
            if (displayText) {
                displayText.textContent = option.textContent || value;
            }
            options.forEach((item) => item.classList.remove('selected'));
            option.classList.add('selected');
            dropdown.classList.remove('open');
            if (hiddenInput && oldValue !== value) {
                hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    });
}

function setAiImagePricingDropdownOptions(dropdownId = '', options = [], selectedValue = '', emptyLabel = '暂无可选项') {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return '';
    const list = dropdown.querySelector('.select-options');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');
    const normalizedOptions = (Array.isArray(options) ? options : [])
        .map((item) => ({
            value: String(item.value || '').trim(),
            label: String(item.label || item.value || '').trim(),
            hint: String(item.hint || '').trim()
        }))
        .filter((item) => item.value && item.label);
    const selected = normalizedOptions.find((item) => item.value === selectedValue) || normalizedOptions[0] || null;
    if (list) {
        list.innerHTML = normalizedOptions.length
            ? normalizedOptions.map((item) => `
                <div class="select-option ${selected?.value === item.value ? 'selected' : ''}" data-value="${escapeHtml(item.value)}">
                    ${escapeHtml(item.label)}${item.hint ? ` · ${escapeHtml(item.hint)}` : ''}
                </div>
            `).join('')
            : `<div class="select-option selected" data-value="">${escapeHtml(emptyLabel)}</div>`;
    }
    if (hiddenInput) {
        hiddenInput.value = selected?.value || '';
        delete hiddenInput.dataset.adminDropdownDirty;
    }
    if (displayText) {
        displayText.textContent = selected?.label || emptyLabel;
    }
    bindAiImagePricingDropdownOptions(dropdownId);
    return selected?.value || '';
}

function syncAiImagePricingProviderOptions(mode = '', desiredProviderId = '') {
    const targetMode = normalizeAiImagePricingMode(mode || document.getElementById('aiImagePricingModeInput')?.value || 'text');
    const normalizedDesiredProviderId = normalizeAiImagePricingProviderValue(desiredProviderId);
    const providerOptions = getAiImagePricingProviderOptions(targetMode).map((item) => ({
        value: item.providerId,
        label: item.label,
        hint: `${item.models.length} 个模型`
    }));
    if (normalizedDesiredProviderId === '*') {
        providerOptions.unshift({
            value: '*',
            label: '全部上游',
            hint: '旧规则'
        });
    }
    return setAiImagePricingDropdownOptions(
        'aiImagePricingProviderDropdown',
        providerOptions,
        normalizedDesiredProviderId,
        `暂无${getAiImagePricingModeLabel(targetMode)}上游`
    );
}

function syncAiImagePricingModelOptions(mode = '', providerId = '', desiredModel = '') {
    const targetMode = normalizeAiImagePricingMode(mode || document.getElementById('aiImagePricingModeInput')?.value || 'text');
    const normalizedProviderId = normalizeAiImagePricingProviderValue(providerId || document.getElementById('aiImagePricingProviderInput')?.value || '');
    const options = getAiImagePricingModelSelectOptions(targetMode, normalizedProviderId)
        .map((item) => ({
            value: item.value,
            label: item.label,
            hint: item.providerLabel
        }));
    if (normalizedProviderId && normalizedProviderId !== '*') {
        const providerLabel = getAiImagePricingProviderLabel(normalizedProviderId);
        options.unshift({
            value: '*',
            label: '应用全部',
            hint: providerLabel || '当前上游'
        });
    } else if (String(desiredModel || '').trim() === '*') {
        options.unshift({
            value: '*',
            label: '全部模型',
            hint: '旧规则'
        });
    }
    const selected = setAiImagePricingDropdownOptions(
        'aiImagePricingModelDropdown',
        options,
        String(desiredModel || '').trim(),
        `暂无${getAiImagePricingModeLabel(targetMode)}模型`
    );
    const datalist = document.getElementById('aiImagePricingModelOptions');
    if (datalist) {
        datalist.innerHTML = options
            .map((item) => `<option value="${escapeHtml(item.value)}"></option>`)
            .join('');
    }
    return selected;
}

function updateAiImagePricingDeleteButton(ruleId = '') {
    const button = document.getElementById('aiImagePricingDeleteButton');
    if (!button) return;
    const id = String(ruleId || '').trim();
    button.dataset.aiImagePricingId = id;
    button.disabled = !id;
}

function updateAiImagePricingStrategyVisibility() {
    const strategy = normalizeAiImagePricingStrategy(document.getElementById('aiImagePricingStrategyInput')?.value || 'per_request');
    const mode = normalizeAiImagePricingMode(document.getElementById('aiImagePricingModeInput')?.value || 'text');
    const tokenPanel = document.getElementById('aiImagePricingTokenPanel');
    const pointsLabel = document.getElementById('aiImagePricingPointsLabel');
    const pointsField = document.querySelector('[data-ai-pricing-field="points"]');
    const badge = document.getElementById('aiImagePricingStrategyBadge');
    const summary = document.getElementById('aiImagePricingEditorSummary');
    const manualTokenFields = document.querySelectorAll('[data-ai-pricing-token-manual]');
    if (tokenPanel) {
        tokenPanel.hidden = strategy !== 'token_sub2api';
    }
    manualTokenFields.forEach((el) => {
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        el.querySelectorAll('input, select, textarea, button').forEach((input) => {
            input.tabIndex = -1;
        });
    });
    if (pointsLabel) {
        pointsLabel.textContent = strategy === 'fixed_points' ? '固定积分' : '单次积分';
    }
    if (pointsField) {
        pointsField.hidden = strategy === 'token_sub2api';
    }
    if (badge) {
        badge.textContent = getAiImagePricingStrategyLabel(strategy);
    }
    if (summary) {
        summary.textContent = strategy === 'token_sub2api'
            ? '按 Sub2API 使用记录里的 actual_cost 扣费，$1 = 1 积分。'
            : `${getAiImagePricingModeLabel(mode)} · ${getAiImagePricingStrategyLabel(strategy)}`;
    }
    const showVisualSpec = isAiImagePricingVisualMode(mode);
    const showQuantity = isAiImagePricingQuantityMode(mode);
    const showImageOutputTokens = false;
    const fieldVisibility = {
        resolution: showVisualSpec,
        ratio: showVisualSpec,
        quantity: showQuantity,
        imageOutput: showImageOutputTokens
    };
    Object.entries(fieldVisibility).forEach(([field, visible]) => {
        document.querySelectorAll(`[data-ai-pricing-field="${field}"]`).forEach((el) => {
            el.hidden = !visible;
        });
    });
    if (!showVisualSpec) {
        setCustomDropdownValue?.('aiImagePricingResolutionDropdown', '*');
        setCustomDropdownValue?.('aiImagePricingRatioDropdown', '*');
    } else if (mode === 'video') {
        const currentResolution = document.getElementById('aiImagePricingResolutionInput')?.value || '';
        if (!['480p', '720p', '1080p', '4k', '*'].includes(currentResolution)) {
            setCustomDropdownValue?.('aiImagePricingResolutionDropdown', '720p');
        }
    }
    if (!showQuantity) {
        const quantityInput = document.getElementById('aiImagePricingQuantityInput');
        if (quantityInput) quantityInput.value = '1';
    }
    if (!showImageOutputTokens) {
        ['aiImagePricingImageOutputRateInput', 'aiImagePricingEstimateImageOutputTokensInput'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
    }
}

function refreshAiImagePricingTokenPreview() {
    const config = {
        inputRate: document.getElementById('aiImagePricingInputRateInput')?.value,
        outputRate: document.getElementById('aiImagePricingOutputRateInput')?.value,
        cacheWriteRate: document.getElementById('aiImagePricingCacheWriteRateInput')?.value,
        cacheReadRate: document.getElementById('aiImagePricingCacheReadRateInput')?.value,
        imageOutputRate: document.getElementById('aiImagePricingImageOutputRateInput')?.value,
        requestBase: document.getElementById('aiImagePricingRequestBaseInput')?.value,
        multiplier: document.getElementById('aiImagePricingMultiplierInput')?.value,
        estimateInputTokens: document.getElementById('aiImagePricingEstimateInputTokensInput')?.value,
        estimateOutputTokens: document.getElementById('aiImagePricingEstimateOutputTokensInput')?.value,
        estimateCacheWriteTokens: document.getElementById('aiImagePricingEstimateCacheWriteTokensInput')?.value,
        estimateCacheReadTokens: document.getElementById('aiImagePricingEstimateCacheReadTokensInput')?.value,
        estimateImageOutputTokens: document.getElementById('aiImagePricingEstimateImageOutputTokensInput')?.value
    };
    const points = calculateAiImagePricingTokenPoints(config);
    const preview = document.getElementById('aiImagePricingPreviewText');
    const strategy = normalizeAiImagePricingStrategy(document.getElementById('aiImagePricingStrategyInput')?.value || 'per_request');
    if (preview) {
        preview.textContent = strategy === 'token_sub2api'
            ? '$1 = 1 积分'
            : `预估 ${points} 积分`;
    }
    const pointsInput = document.getElementById('aiImagePricingPointsInput');
    if (pointsInput && strategy === 'token_sub2api' && document.activeElement !== pointsInput) {
        pointsInput.value = '';
    }
}

function fillAiImagePricingEstimateDefaults(mode = '') {
    const defaults = getAiImagePricingEstimateDefaults(mode);
    const map = {
        aiImagePricingEstimateInputTokensInput: defaults.input_tokens,
        aiImagePricingEstimateOutputTokensInput: defaults.output_tokens,
        aiImagePricingEstimateCacheWriteTokensInput: defaults.cache_write_tokens,
        aiImagePricingEstimateCacheReadTokensInput: defaults.cache_read_tokens,
        aiImagePricingEstimateImageOutputTokensInput: defaults.image_output_tokens
    };
    Object.entries(map).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input && !String(input.value || '').trim()) {
            input.value = value ? String(value) : '';
        }
    });
}

function bindAiImagePricingEditorEvents() {
    const editor = document.getElementById('aiImagePricingEditor');
    if (!editor || editor.dataset.pricingEditorBound === '1') return;
    editor.dataset.pricingEditorBound = '1';

    ['aiImagePricingModeInput', 'aiImagePricingStrategyInput', 'aiImagePricingProviderInput'].forEach((id) => {
        const input = document.getElementById(id);
        input?.addEventListener('change', () => {
            if (id === 'aiImagePricingModeInput') {
                const providerId = syncAiImagePricingProviderOptions(input.value, '');
                syncAiImagePricingModelOptions(input.value, providerId, '');
                fillAiImagePricingEstimateDefaults(input.value);
            } else if (id === 'aiImagePricingProviderInput') {
                syncAiImagePricingModelOptions(document.getElementById('aiImagePricingModeInput')?.value || 'text', input.value, '');
            }
            updateAiImagePricingStrategyVisibility();
            refreshAiImagePricingTokenPreview();
        });
    });

    [
        'aiImagePricingInputRateInput',
        'aiImagePricingOutputRateInput',
        'aiImagePricingCacheWriteRateInput',
        'aiImagePricingCacheReadRateInput',
        'aiImagePricingImageOutputRateInput',
        'aiImagePricingRequestBaseInput',
        'aiImagePricingMultiplierInput',
        'aiImagePricingEstimateInputTokensInput',
        'aiImagePricingEstimateOutputTokensInput',
        'aiImagePricingEstimateCacheWriteTokensInput',
        'aiImagePricingEstimateCacheReadTokensInput',
        'aiImagePricingEstimateImageOutputTokensInput'
    ].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', refreshAiImagePricingTokenPreview);
    });
}

function setAiImagePricingEditorDraft(rule = null) {
    const source = rule && typeof rule === 'object' ? rule : {};
    const metadata = getAiImagePricingMetadata(source);
    const strategy = getAiImagePricingStrategy(source);
    const mode = normalizeAiImagePricingMode(source.mode || document.getElementById('aiImagePricingModeInput')?.value || 'text');
    const providerId = getAiImagePricingProviderId(source);
    const tokenConfig = getAiImagePricingTokenConfigFromRule({
        ...source,
        mode,
        metadata
    });
    const title = document.getElementById('aiImagePricingEditorTitle');
    const idInput = document.getElementById('aiImagePricingIdInput');
    if (title) {
        title.textContent = source.id ? '编辑价格规则' : '新增价格规则';
    }
    if (idInput) {
        idInput.value = source.id || '';
    }

    setCustomDropdownValue?.('aiImagePricingModeDropdown', mode);
    setCustomDropdownValue?.('aiImagePricingStrategyDropdown', strategy);
    setCustomDropdownValue?.('aiImagePricingResolutionDropdown', String(source.resolution || (mode === 'video' ? '720p' : '1k')).toLowerCase());
    setCustomDropdownValue?.('aiImagePricingRatioDropdown', source.ratio || '*');
    const selectedProviderId = syncAiImagePricingProviderOptions(mode, providerId);
    const selectedModel = syncAiImagePricingModelOptions(mode, selectedProviderId, source.model || '');

    const fieldValues = {
        aiImagePricingModelInput: selectedModel || source.model || '',
        aiImagePricingQuantityInput: source.quantity || 1,
        aiImagePricingPointsInput: source.points || '',
        aiImagePricingInputRateInput: tokenConfig.inputRate || '',
        aiImagePricingOutputRateInput: tokenConfig.outputRate || '',
        aiImagePricingCacheWriteRateInput: tokenConfig.cacheWriteRate || '',
        aiImagePricingCacheReadRateInput: tokenConfig.cacheReadRate || '',
        aiImagePricingImageOutputRateInput: tokenConfig.imageOutputRate || '',
        aiImagePricingRequestBaseInput: tokenConfig.requestBase || '',
        aiImagePricingMultiplierInput: tokenConfig.multiplier || 1,
        aiImagePricingEstimateInputTokensInput: tokenConfig.estimateInputTokens || '',
        aiImagePricingEstimateOutputTokensInput: tokenConfig.estimateOutputTokens || '',
        aiImagePricingEstimateCacheWriteTokensInput: tokenConfig.estimateCacheWriteTokens || '',
        aiImagePricingEstimateCacheReadTokensInput: tokenConfig.estimateCacheReadTokens || '',
        aiImagePricingEstimateImageOutputTokensInput: tokenConfig.estimateImageOutputTokens || ''
    };
    Object.entries(fieldValues).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = String(value ?? '');
    });
    fillAiImagePricingEstimateDefaults(mode);
    updateAiImagePricingDeleteButton(source.id || '');
    updateAiImagePricingStrategyVisibility();
    refreshAiImagePricingTokenPreview();
}

function resetAiImagePricingEditor() {
    adminAiImageState.selectedPricingId = '__new__';
    setAiImagePricingEditorDraft({
        mode: 'text',
        model: '',
        resolution: '1k',
        ratio: '*',
        quantity: 1,
        points: '',
        metadata: {
            billing_strategy: 'per_request'
        }
    });
    renderAiImagePricingList();
}

function selectAiImagePricingRule(id = '') {
    const normalizedId = String(id || '').trim();
    const rule = adminAiImageState.pricing.find((item) => String(item.id || '') === normalizedId);
    if (!rule) return null;
    adminAiImageState.selectedPricingId = normalizedId;
    setAiImagePricingEditorDraft(rule);
    renderAiImagePricingList();
    return rule;
}

function getAiImagePricingRuleSummary(rule = {}) {
    const strategy = getAiImagePricingStrategy(rule);
    const metadata = getAiImagePricingMetadata(rule);
    const pricing = metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
        ? metadata.pricing
        : {};
    if (strategy === 'token_sub2api') {
        return '按 actual_cost 扣费';
    }
    if (strategy === 'fixed_points') {
        return `${Number(rule.points || 0)} 积分 / 次`;
    }
    return `${Number(rule.points || 0)} 积分${rule.quantity > 1 ? ` / ${rule.quantity} 张` : ' / 次'}`;
}

function renderAiImagePricingList() {
    const list = document.getElementById('aiImagePricingList');
    if (!list) return;
    bindAiImagePricingEditorEvents();
    const currentMode = normalizeAiImagePricingMode(document.getElementById('aiImagePricingModeInput')?.value || 'text');
    const currentProviderId = document.getElementById('aiImagePricingProviderInput')?.value || '';
    const selectedProviderId = syncAiImagePricingProviderOptions(currentMode, currentProviderId);
    syncAiImagePricingModelOptions(currentMode, selectedProviderId, document.getElementById('aiImagePricingModelInput')?.value || '');

    if (adminAiImageState.loading && !adminAiImageState.pricing.length) {
        list.innerHTML = '<div class="ai-image-admin-pricing-list-loading"><span></span><span></span><span></span></div>';
        return;
    }

    const activePricing = adminAiImageState.pricing.filter((rule) => rule.is_active !== false);
    if (!activePricing.length) {
        list.innerHTML = '<div class="ai-image-admin-empty">暂无价格规则，先新增一条默认图片生成价格。</div>';
        if (!adminAiImageState.selectedPricingId) {
            setAiImagePricingEditorDraft(null);
        }
        return;
    }

    if (adminAiImageState.selectedPricingId && adminAiImageState.selectedPricingId !== '__new__' && !activePricing.some((rule) => String(rule.id || '') === adminAiImageState.selectedPricingId)) {
        adminAiImageState.selectedPricingId = '';
    }

    const selectedId = adminAiImageState.selectedPricingId === '__new__'
        ? ''
        : (adminAiImageState.selectedPricingId || String(activePricing[0]?.id || ''));
    if (!adminAiImageState.selectedPricingId && selectedId) {
        adminAiImageState.selectedPricingId = selectedId;
        setAiImagePricingEditorDraft(activePricing[0]);
    }

    const groups = activePricing.reduce((map, rule) => {
        const mode = normalizeAiImagePricingMode(rule.mode);
        if (!map.has(mode)) map.set(mode, []);
        map.get(mode).push(rule);
        return map;
    }, new Map());

    list.innerHTML = Array.from(groups.entries()).map(([mode, rules]) => `
        <div class="ai-image-admin-pricing-group">
            <div class="ai-image-admin-pricing-group__title">
                <span>${escapeHtml(getAiImagePricingModeLabel(mode))}</span>
                <em>${rules.length} 条</em>
            </div>
            <div class="ai-image-admin-pricing-group__rules">
                ${rules.slice(0, 120).map((rule) => {
                    const ruleId = String(rule.id || '');
                    const strategy = getAiImagePricingStrategy(rule);
                    const ruleModelLabel = String(rule.model || '*').trim() === '*' ? '应用全部' : (rule.model || '*');
                    return `
                        <button class="ai-image-admin-pricing-rule ${ruleId && ruleId === selectedId ? 'is-active' : ''}" type="button"
                            data-admin-action="settings-select-ai-image-pricing"
                            data-ai-image-pricing-id="${escapeHtml(ruleId)}">
                            <span class="ai-image-admin-pricing-rule__main">
                                <strong>${escapeHtml(ruleModelLabel)}</strong>
                                <small>${escapeHtml([getAiImagePricingProviderLabel(getAiImagePricingProviderId(rule)) || '全部上游', rule.resolution || '*', rule.ratio || '*', `${rule.quantity || 1} 次`].join(' · '))}</small>
                            </span>
                            <span class="ai-image-admin-pricing-rule__meta">
                                <em>${escapeHtml(getAiImagePricingStrategyLabel(strategy))}</em>
                                <b>${escapeHtml(getAiImagePricingRuleSummary(rule))}</b>
                            </span>
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');
}

function renderAiImageApiBaseUrlList() {
    const list = document.getElementById('aiImageApiBaseList');
    if (!list) return;

    if (adminAiImageState.loading && !adminAiImageState.apiBaseUrls.length) {
        list.innerHTML = '<p class="loading-text">加载用户 API 白名单...</p>';
        return;
    }

    const apiBaseUrlWarning = String(adminAiImageState.warnings?.api_base_urls || '').trim();
    if (apiBaseUrlWarning && !adminAiImageState.apiBaseUrls.length) {
        list.innerHTML = `<div class="ai-image-admin-empty ai-image-admin-empty--warning">${escapeHtml(apiBaseUrlWarning)}</div>`;
        return;
    }

    if (!adminAiImageState.apiBaseUrls.length) {
        list.innerHTML = '<div class="ai-image-admin-empty">暂无用户 API 白名单。建议保留 FatherKey / Zaoyoe 的 Sub2API 地址。</div>';
        return;
    }

    list.innerHTML = adminAiImageState.apiBaseUrls.slice(0, 50).map((item) => {
        const baseUrl = item.base_url || item.baseUrl || '';
        return `
            <article class="ai-image-admin-row ${item.is_active === false ? 'is-disabled' : ''}">
                <div class="ai-image-admin-row__main">
                    <strong>${escapeHtml(item.label || 'Sub2API')}</strong>
                    <span>${escapeHtml(baseUrl)} · ${escapeHtml(item.site || 'all')}</span>
                </div>
                <div class="ai-image-admin-row__meta">
                    <span>${item.is_active === false ? '已停用' : '启用中'}</span>
                    <button class="btn-sm btn-secondary" type="button" data-admin-action="settings-disable-ai-image-api-base" data-ai-image-api-base-id="${escapeHtml(item.id || '')}">
                        停用
                    </button>
                </div>
            </article>
        `;
    }).join('');
}

function renderAiImageAgentList() {
    const list = document.getElementById('aiImageAgentList');
    if (!list) return;

    if (adminAiImageState.loading && !adminAiImageState.agents.length) {
        list.innerHTML = '<p class="loading-text">加载智能体...</p>';
        return;
    }

    if (!adminAiImageState.agents.length) {
        list.innerHTML = '<div class="ai-image-admin-empty">暂无智能体。建议先配置高清修复、抠人像、换背景、风格统一。</div>';
        return;
    }

    list.innerHTML = adminAiImageState.agents.slice(0, 80).map((agent) => `
        <article class="ai-image-admin-row ${agent.is_active === false ? 'is-disabled' : ''}">
            <div class="ai-image-admin-row__main">
                <strong>${escapeHtml(agent.name || agent.slug || '未命名智能体')}</strong>
                <span>${escapeHtml(agent.slug || '')} · ${escapeHtml(agent.default_model || ADMIN_AI_IMAGE_DEFAULT_MODEL)} · ${escapeHtml(agent.default_resolution || '1k')}</span>
            </div>
            <div class="ai-image-admin-row__meta">
                <span>${agent.is_active === false ? '已停用' : '启用中'}</span>
                <button class="btn-sm btn-secondary" type="button" data-admin-action="settings-disable-ai-image-agent" data-ai-image-agent-id="${escapeHtml(agent.id || '')}">
                    停用
                </button>
            </div>
        </article>
    `).join('');
}

function setAiImageGuardrailInputValue(id, value) {
    const input = document.getElementById(id);
    if (input && document.activeElement !== input) {
        input.value = String(value ?? '');
    }
}

function renderAiImageGuardrailsPanel() {
    const guardrails = getAiImageGuardrails();
    setAiImageGuardrailInputValue('aiImageGuardSubmitUserInput', guardrails.submit.user.limit);
    setAiImageGuardrailInputValue('aiImageGuardSubmitIpInput', guardrails.submit.ip.limit);
    setAiImageGuardrailInputValue('aiImageGuardSubmitHeavyInput', guardrails.submit.heavyUser.limit);
    setAiImageGuardrailInputValue('aiImageGuardSubmitModelInput', guardrails.submit.model.limit);
    setAiImageGuardrailInputValue('aiImageGuardUploadUserInput', guardrails.upload.user.limit);
    setAiImageGuardrailInputValue('aiImageGuardDownloadUserInput', guardrails.download.user.limit);
    setAiImageGuardrailInputValue('aiImageGuardRunningInput', guardrails.tasks.running);
    setAiImageGuardrailInputValue('aiImageGuardQueuedInput', guardrails.tasks.queued);
    setAiImageGuardrailInputValue('aiImageGuardActiveInput', guardrails.tasks.active);

    const status = document.getElementById('aiImageGuardrailStatus');
    if (status) {
        const dot = status.querySelector('.status-dot');
        const text = status.querySelector('span:last-child');
        if (adminAiImageState.loading && !adminAiImageState.loaded) {
            if (dot) dot.className = 'status-dot loading';
            if (text) text.textContent = '正在读取成本防火墙配置...';
        } else {
            if (dot) dot.className = 'status-dot ready';
            if (text) {
                text.textContent = `用户 ${guardrails.submit.user.limit}/分钟 · IP ${guardrails.submit.ip.limit}/分钟 · 活跃 ${guardrails.tasks.active}`;
            }
        }
    }
}

function formatAiImageBytes(bytes = 0) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    const digits = index <= 1 ? 0 : 2;
    return `${size.toFixed(digits)} ${units[index]}`;
}

function setAiImageStorageInputValue(id, value) {
    const input = document.getElementById(id);
    if (input && document.activeElement !== input) {
        input.value = String(value ?? '');
    }
}

function setAiImageStorageMetric(kind, text) {
    const el = document.querySelector(`[data-ai-image-storage="${kind}"]`);
    if (el) el.textContent = text;
}

function renderAiImageStoragePanel() {
    const usage = getAiImageStorageUsage();
    const policy = getAiImageStoragePolicy();

    setAiImageStorageMetric('total', usage.errorMessage
        ? '统计失败'
        : `${formatAiImageBytes(usage.totalBytes)} · ${usage.estimatedTotalGb.toFixed(4)} GB`);
    setAiImageStorageMetric('objects', `${usage.previewObjects} / ${usage.originalObjects}`);
    setAiImageStorageMetric('pending', `${usage.pendingOriginals} 待转存 · ${usage.failedOriginals} 失败`);
    setAiImageStorageMetric('unknown', `${usage.unknownPreviewObjects + usage.unknownOriginalObjects} 个对象`);

    setAiImageStorageInputValue('aiImageStoragePreviewRetentionInput', policy.previewRetentionDays);
    setAiImageStorageInputValue('aiImageStorageOriginalRetentionInput', policy.originalRetentionDays);
    setAiImageStorageInputValue('aiImageStorageFailedRetentionInput', policy.failedRetentionDays);
    setAiImageStorageInputValue('aiImageStorageWarnGbInput', policy.warnStorageGb);
    setAiImageStorageInputValue('aiImageStorageStopGbInput', policy.stopStorageGb);

    const badge = document.getElementById('aiImageStoragePolicyBadge');
    if (badge) {
        badge.textContent = policy.lifecycleEnabled ? '生命周期已启用' : '仅监控';
    }

    const status = document.getElementById('aiImageStorageStatus');
    if (status) {
        const dot = status.querySelector('.status-dot');
        const text = status.querySelector('span:last-child');
        if (adminAiImageState.loading && !adminAiImageState.loaded) {
            if (dot) dot.className = 'status-dot loading';
            if (text) text.textContent = '正在读取 R2 用量和生命周期策略...';
        } else if (usage.errorMessage) {
            if (dot) dot.className = 'status-dot warning';
            if (text) text.textContent = `用量统计失败：${usage.errorMessage}`;
        } else {
            const tone = usage.tone === 'danger' ? 'error' : (usage.tone === 'warning' ? 'warning' : 'ready');
            if (dot) dot.className = `status-dot ${tone}`;
            if (text) {
                text.textContent = policy.lifecycleEnabled
                    ? `策略已启用：预览 ${policy.previewRetentionDays} 天，原图 ${policy.originalRetentionDays} 天`
                    : `监控中：告警 ${policy.warnStorageGb} GB，熔断 ${policy.stopStorageGb} GB`;
            }
        }
    }
}

function renderAiImageAdminPanel() {
    initCustomDropdown?.();
    bindAiImageAdminTooltips();
    renderAiImageRuntimeStatus();
    renderAiImageModelConfigPanel();
    renderAiImageGuardrailsPanel();
    renderAiImageStoragePanel();
    renderAiImageApiBaseUrlList();
    renderAiImagePricingList();
    renderAiImageAgentList();
}

function readAiImagePricingDraft() {
    const strategy = normalizeAiImagePricingStrategy(document.getElementById('aiImagePricingStrategyInput')?.value || 'per_request');
    const isSub2ApiActualCost = strategy === 'token_sub2api';
    const mode = normalizeAiImagePricingMode(document.getElementById('aiImagePricingModeInput')?.value || 'text');
    const providerId = normalizeAiImagePricingProviderValue(document.getElementById('aiImagePricingProviderInput')?.value || '');
    const providerLabel = getAiImagePricingProviderLabel(providerId);
    const model = String(document.getElementById('aiImagePricingModelInput')?.value || '').trim();
    const isVisualMode = isAiImagePricingVisualMode(mode);
    const supportsImageOutputTokens = isAiImagePricingImageOutputTokenMode(mode);
    const quantity = isAiImagePricingQuantityMode(mode)
        ? normalizeAiImagePricingInt(document.getElementById('aiImagePricingQuantityInput')?.value, 1, { min: 1, max: 8 })
        : 1;
    const tokenConfig = isSub2ApiActualCost
        ? {
            inputRate: 0,
            outputRate: 0,
            cacheWriteRate: 0,
            cacheReadRate: 0,
            imageOutputRate: 0,
            requestBase: 0,
            multiplier: 1,
            estimateInputTokens: 0,
            estimateOutputTokens: 0,
            estimateCacheWriteTokens: 0,
            estimateCacheReadTokens: 0,
            estimateImageOutputTokens: 0
        }
        : {
            inputRate: document.getElementById('aiImagePricingInputRateInput')?.value,
            outputRate: document.getElementById('aiImagePricingOutputRateInput')?.value,
            cacheWriteRate: document.getElementById('aiImagePricingCacheWriteRateInput')?.value,
            cacheReadRate: document.getElementById('aiImagePricingCacheReadRateInput')?.value,
            imageOutputRate: supportsImageOutputTokens ? document.getElementById('aiImagePricingImageOutputRateInput')?.value : 0,
            requestBase: document.getElementById('aiImagePricingRequestBaseInput')?.value,
            multiplier: document.getElementById('aiImagePricingMultiplierInput')?.value,
            estimateInputTokens: document.getElementById('aiImagePricingEstimateInputTokensInput')?.value,
            estimateOutputTokens: document.getElementById('aiImagePricingEstimateOutputTokensInput')?.value,
            estimateCacheWriteTokens: document.getElementById('aiImagePricingEstimateCacheWriteTokensInput')?.value,
            estimateCacheReadTokens: document.getElementById('aiImagePricingEstimateCacheReadTokensInput')?.value,
            estimateImageOutputTokens: supportsImageOutputTokens ? document.getElementById('aiImagePricingEstimateImageOutputTokensInput')?.value : 0
        };
    const estimatedTokenPoints = isSub2ApiActualCost ? 0 : calculateAiImagePricingTokenPoints(tokenConfig);
    const rawPoints = Number(document.getElementById('aiImagePricingPointsInput')?.value || 0);
    const points = isSub2ApiActualCost ? 0 : rawPoints;
    const id = String(document.getElementById('aiImagePricingIdInput')?.value || '').trim();
    return {
        action: 'save-pricing',
        ...(id ? { id } : {}),
        site: 'all',
        billing_mode: 'points',
        model,
        mode,
        resolution: isVisualMode ? (String(document.getElementById('aiImagePricingResolutionInput')?.value || (mode === 'video' ? '720p' : '1k')).trim() || (mode === 'video' ? '720p' : '1k')) : '*',
        ratio: isVisualMode ? (String(document.getElementById('aiImagePricingRatioInput')?.value || '*').trim() || '*') : '*',
        quantity,
        points,
        priority: 100,
        metadata: {
            billing_strategy: strategy,
            provider_id: providerId,
            providerId,
            provider_label: providerLabel,
            providerLabel,
            pricing: {
                billing_strategy: strategy,
                provider_id: providerId,
                providerId,
                provider_label: providerLabel,
                providerLabel,
                unit: isSub2ApiActualCost ? 'sub2api_actual_cost_usd' : 'points',
                cost_source: isSub2ApiActualCost ? 'sub2api_usage_actual_cost' : '',
                points_per_usd: isSub2ApiActualCost ? 1 : 0,
                request_base: normalizeAiImagePricingNumber(tokenConfig.requestBase, 0, { precision: 2 }),
                multiplier: normalizeAiImagePricingNumber(tokenConfig.multiplier, 1, { min: 0, max: 1000, precision: 4 }) || 1,
                rates: {
                    input: normalizeAiImagePricingNumber(tokenConfig.inputRate, 0),
                    output: normalizeAiImagePricingNumber(tokenConfig.outputRate, 0),
                    cache_write: normalizeAiImagePricingNumber(tokenConfig.cacheWriteRate, 0),
                    cache_read: normalizeAiImagePricingNumber(tokenConfig.cacheReadRate, 0),
                    image_output: normalizeAiImagePricingNumber(tokenConfig.imageOutputRate, 0)
                },
                estimate: {
                    input_tokens: normalizeAiImagePricingInt(tokenConfig.estimateInputTokens, 0),
                    output_tokens: normalizeAiImagePricingInt(tokenConfig.estimateOutputTokens, 0),
                    cache_write_tokens: normalizeAiImagePricingInt(tokenConfig.estimateCacheWriteTokens, 0),
                    cache_read_tokens: normalizeAiImagePricingInt(tokenConfig.estimateCacheReadTokens, 0),
                    image_output_tokens: normalizeAiImagePricingInt(tokenConfig.estimateImageOutputTokens, 0),
                    estimated_points: estimatedTokenPoints
                },
                sub2api_compatible: isSub2ApiActualCost
            }
        }
    };
}

function readAiImageAgentDraft() {
    const name = String(document.getElementById('aiImageAgentNameInput')?.value || '').trim();
    const slug = String(document.getElementById('aiImageAgentSlugInput')?.value || '').trim();
    const systemPrompt = String(document.getElementById('aiImageAgentPromptInput')?.value || '').trim();
    return {
        action: 'save-agent',
        site: 'all',
        name,
        slug,
        system_prompt: systemPrompt,
        mode: 'agent',
        default_model: ADMIN_AI_IMAGE_DEFAULT_MODEL,
        default_resolution: '2k',
        default_ratio: '1:1',
        description: systemPrompt.slice(0, 180),
        metadata: {}
    };
}

function normalizeAdminAiImageApiBaseUrl(value = '') {
    return String(value || '').trim().replace(/\/+$/, '');
}

function readAiImageApiBaseUrlDraft() {
    const label = String(document.getElementById('aiImageApiBaseLabelInput')?.value || '').trim();
    const baseUrl = normalizeAdminAiImageApiBaseUrl(document.getElementById('aiImageApiBaseUrlInput')?.value || '');
    const site = String(document.getElementById('aiImageApiBaseSiteInput')?.value || 'all').trim() || 'all';
    return {
        action: 'save-api-base-url',
        site,
        label,
        base_url: baseUrl,
        display_order: 100,
        metadata: {}
    };
}

function readAiImageGuardrailsDraft() {
    const current = getAiImageGuardrails();
    const readLimit = (id, fallback, max = 100000) => normalizeAiImageGuardrailInt(
        document.getElementById(id)?.value,
        fallback,
        { min: 1, max }
    );
    const runningLimit = readLimit('aiImageGuardRunningInput', current.tasks.running, 20);
    const queuedLimit = readLimit('aiImageGuardQueuedInput', current.tasks.queued, 100);
    const activeLimit = readLimit('aiImageGuardActiveInput', current.tasks.active, 100);

    return normalizeAiImageGuardrails({
        ...current,
        submit: {
            ...current.submit,
            user: {
                ...current.submit.user,
                limit: readLimit('aiImageGuardSubmitUserInput', current.submit.user.limit, 10000)
            },
            ip: {
                ...current.submit.ip,
                limit: readLimit('aiImageGuardSubmitIpInput', current.submit.ip.limit, 10000)
            },
            heavyUser: {
                ...current.submit.heavyUser,
                limit: readLimit('aiImageGuardSubmitHeavyInput', current.submit.heavyUser.limit, 10000)
            },
            model: {
                ...current.submit.model,
                limit: readLimit('aiImageGuardSubmitModelInput', current.submit.model.limit, 10000)
            }
        },
        upload: {
            ...current.upload,
            user: {
                ...current.upload.user,
                limit: readLimit('aiImageGuardUploadUserInput', current.upload.user.limit, 10000)
            }
        },
        download: {
            ...current.download,
            user: {
                ...current.download.user,
                limit: readLimit('aiImageGuardDownloadUserInput', current.download.user.limit, 100000)
            }
        },
        tasks: {
            ...current.tasks,
            running: runningLimit,
            queued: queuedLimit,
            active: Math.max(activeLimit, runningLimit + queuedLimit)
        }
    });
}

function readAiImageStoragePolicyDraft() {
    const current = getAiImageStoragePolicy();
    const readInt = (id, fallback, min = 1) => normalizeAiImageStorageInt(
        document.getElementById(id)?.value,
        fallback,
        { min, max: 3650 }
    );
    const readGb = (id, fallback) => normalizeAiImageStorageNumber(
        document.getElementById(id)?.value,
        fallback,
        { min: 0.1, max: 100000 }
    );
    const policy = normalizeAiImageStoragePolicy({
        previewRetentionDays: readInt('aiImageStoragePreviewRetentionInput', current.previewRetentionDays, 7),
        originalRetentionDays: readInt('aiImageStorageOriginalRetentionInput', current.originalRetentionDays, 7),
        failedRetentionDays: readInt('aiImageStorageFailedRetentionInput', current.failedRetentionDays, 1),
        warnStorageGb: readGb('aiImageStorageWarnGbInput', current.warnStorageGb),
        stopStorageGb: readGb('aiImageStorageStopGbInput', current.stopStorageGb),
        lifecycleEnabled: current.lifecycleEnabled
    });
    if (policy.warnStorageGb > policy.stopStorageGb) {
        policy.stopStorageGb = policy.warnStorageGb;
    }
    return policy;
}

async function postAiImageAdminConfig(payload = {}) {
    const headers = await getAdminApiHeaders();
    const response = await (window.AdminApi?.fetch || fetch)(getAiImageConfigUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
        throw new Error(data.message || '保存 AI 图片配置失败');
    }
    return data;
}

async function saveAiImageGuardrails() {
    const guardrails = readAiImageGuardrailsDraft();
    try {
        showAdminStudioToast('正在保存 AI 图片成本防火墙...', 'info');
        await postAiImageAdminConfig({
            action: 'save-guardrails',
            site: normalizeAdminAiImageSite(),
            guardrails
        });
        adminAiImageState.guardrails = guardrails;
        renderAiImageGuardrailsPanel();
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast('AI 图片成本防火墙已保存', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save AI image guardrails:', err);
        showAdminStudioToast(err.message || '保存 AI 图片成本防火墙失败', 'error');
        return false;
    }
}

async function saveAiImageStoragePolicy() {
    const storagePolicy = readAiImageStoragePolicyDraft();
    try {
        showAdminStudioToast('正在保存 AI 图片 R2 生命周期策略...', 'info');
        await postAiImageAdminConfig({
            action: 'save-storage-policy',
            site: normalizeAdminAiImageSite(),
            storage_policy: storagePolicy
        });
        adminAiImageState.storagePolicy = storagePolicy;
        renderAiImageStoragePanel();
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast('AI 图片 R2 生命周期策略已保存', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save AI image storage policy:', err);
        showAdminStudioToast(err.message || '保存 AI 图片 R2 生命周期策略失败', 'error');
        return false;
    }
}

async function saveAiImagePricingRule() {
    const draft = readAiImagePricingDraft();
    if (!draft.metadata?.provider_id || draft.metadata.provider_id === '*') {
        showAdminStudioToast('请先选择具体上游', 'warning');
        return false;
    }
    if (!draft.model) {
        showAdminStudioToast('请先选择模型或应用全部', 'warning');
        return false;
    }
    if (draft.metadata?.billing_strategy !== 'token_sub2api' && (!Number.isFinite(Number(draft.points)) || Number(draft.points) < 0)) {
        showAdminStudioToast('请输入有效的积分价格', 'warning');
        return false;
    }

    try {
        showAdminStudioToast('正在保存 AI 图片价格规则...', 'info');
        const payload = await postAiImageAdminConfig(draft);
        const savedId = payload?.pricing?.id || draft.id || '';
        adminAiImageState.selectedPricingId = savedId || adminAiImageState.selectedPricingId;
        await fetchAiImageAdminConfig({ force: true });
        if (savedId) {
            selectAiImagePricingRule(savedId);
        }
        showAdminStudioToast('AI 图片价格规则已保存', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save AI image pricing:', err);
        showAdminStudioToast(err.message || '保存 AI 图片价格失败', 'error');
        return false;
    }
}

async function saveAiImageAgent() {
    const draft = readAiImageAgentDraft();
    if (!draft.name || !draft.system_prompt) {
        showAdminStudioToast('请填写智能体名称和系统情景', 'warning');
        return false;
    }

    try {
        showAdminStudioToast('正在保存 AI 图片智能体...', 'info');
        await postAiImageAdminConfig(draft);
        ['aiImageAgentNameInput', 'aiImageAgentSlugInput', 'aiImageAgentPromptInput'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast('AI 图片智能体已保存', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save AI image agent:', err);
        showAdminStudioToast(err.message || '保存 AI 图片智能体失败', 'error');
        return false;
    }
}

async function saveAiImageApiBaseUrl() {
    const draft = readAiImageApiBaseUrlDraft();
    if (!/^https?:\/\//i.test(draft.base_url)) {
        showAdminStudioToast('请输入有效的 Sub2API Base URL', 'warning');
        return false;
    }

    try {
        showAdminStudioToast('正在保存用户 API 白名单...', 'info');
        await postAiImageAdminConfig(draft);
        ['aiImageApiBaseLabelInput', 'aiImageApiBaseUrlInput'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast('用户 API Base URL 已保存', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save AI image API base URL:', err);
        showAdminStudioToast(err.message || '保存用户 API 白名单失败', 'error');
        return false;
    }
}

async function disableAiImageApiBaseUrl(id = '') {
    if (!id) return false;
    try {
        await postAiImageAdminConfig({ action: 'disable-api-base-url', id });
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast('用户 API Base URL 已停用', 'success');
        return true;
    } catch (err) {
        showAdminStudioToast(err.message || '停用用户 API Base URL 失败', 'error');
        return false;
    }
}

async function deleteAiImagePricingRule(id = '') {
    const targetId = String(id || document.getElementById('aiImagePricingIdInput')?.value || adminAiImageState.selectedPricingId || '').trim();
    if (!targetId || targetId === '__new__') return false;
    try {
        await postAiImageAdminConfig({ action: 'delete-pricing', id: targetId });
        adminAiImageState.selectedPricingId = '';
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast('价格规则已删除', 'success');
        return true;
    } catch (err) {
        showAdminStudioToast(err.message || '删除价格规则失败', 'error');
        return false;
    }
}

const disableAiImagePricingRule = deleteAiImagePricingRule;

async function disableAiImageAgent(id = '') {
    if (!id) return false;
    try {
        await postAiImageAdminConfig({ action: 'disable-agent', id });
        await fetchAiImageAdminConfig({ force: true });
        showAdminStudioToast('智能体已停用', 'success');
        return true;
    } catch (err) {
        showAdminStudioToast(err.message || '停用智能体失败', 'error');
        return false;
    }
}

async function runAiImageWorkerOnce() {
    try {
        showAdminStudioToast('正在执行 AI 图片队列...', 'info');
        const headers = await getAdminApiHeaders();
        const response = await (window.AdminApi?.fetch || fetch)('/api/admin?route=ai-image/run', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                site: '',
                limit: 3
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || 'AI 图片队列执行失败');
        }

        const results = Array.isArray(payload.results) ? payload.results : [];
        adminAiImageState.lastRun = {
            processed: Number(payload.processed || 0),
            succeeded: results.filter((item) => item.status === 'succeeded').length,
            failed: results.filter((item) => item.status === 'failed').length
        };
        renderAiImageRuntimeStatus();
        showAdminStudioToast(`AI 图片队列执行完成：处理 ${adminAiImageState.lastRun.processed} 个`, 'success');
        return true;
    } catch (err) {
        console.error('Failed to run AI image worker:', err);
        showAdminStudioToast(err.message || 'AI 图片队列执行失败', 'error');
        return false;
    }
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
            showAdminStudioToast('已自动切换 AI 分析服务到 Codex Relay。', 'success');
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
        showAdminStudioToast('未输入 Gemini API Key', 'warning');
        return;
    }

    try {
        showAdminStudioToast('正在安全保存 Gemini Key...', 'info');
        const payload = await saveServerManagedGeminiKey(apiKey);
        window.GEMINI_API_KEY = payload.configured ? '__server_proxy__' : '';
        window.GEMINI_API_SOURCE = payload.source || 'stored';
        window.GEMINI_API_DECRYPT_ERROR = payload.decryptErrorMessage || '';
        window.AdminAI.configured = Boolean(payload.configured);
        window.AdminAI.source = window.GEMINI_API_SOURCE;
        renderApiKeySelector();
        updateAnalyzeButton();
        showAdminStudioToast(payload.message || 'Gemini Key 已安全保存到服务端。', 'success');
    } catch (err) {
        console.error('Failed to save Gemini key:', err);
        showAdminStudioToast(err.message || '保存 Gemini Key 失败', 'error');
    }
}

function switchApiKey() {
    showAdminStudioToast('当前始终优先使用后台安全存储，其次才是 Vercel 环境变量。', 'info');
}

function addNewApiKey() {
    promptForApiKey();
}

window.addNewApiKey = addNewApiKey;

async function deleteApiKey() {
    if ((window.GEMINI_API_SOURCE || 'missing') !== 'stored') {
        showAdminStudioToast('当前没有可删除的后台存储 Gemini Key。', 'info');
        return null;
    }

    if (!confirm('确定要删除当前后台安全存储的 Gemini Key 吗？')) {
        return null;
    }

    try {
        const payload = await deleteServerManagedGeminiKey();
        window.GEMINI_API_KEY = payload.configured ? '__server_proxy__' : '';
        window.GEMINI_API_SOURCE = payload.source || 'missing';
        window.GEMINI_API_DECRYPT_ERROR = payload.decryptErrorMessage || '';
        window.AdminAI.configured = Boolean(payload.configured);
        window.AdminAI.source = window.GEMINI_API_SOURCE;
        renderApiKeySelector();
        updateAnalyzeButton();
        showAdminStudioToast(payload.message || 'Gemini Key 已删除', 'success');
        return true;
    } catch (err) {
        console.error('Failed to delete Gemini key:', err);
        showAdminStudioToast(err.message || '删除 Gemini Key 失败', 'error');
        return false;
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
        showAdminStudioToast(validationMessage, 'warning');
        focusCodexConfigPanel();
        return null;
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
        showAdminStudioToast('未输入 Codex API Key', 'warning');
        return false;
    }

    try {
        showAdminStudioToast('正在安全保存 Codex 配置...', 'info');
        const payload = await saveServerManagedCodexConfig({
            apiKey,
            ...draft
        });
        setCodexRuntimeConfig(payload);
        await activateCodexAsCurrentAIService();
        renderApiKeySelector();
        renderCodexConfigPanel();
        showAdminStudioToast(payload.message || 'Codex 配置已安全保存到服务端。', 'success');
        return true;
    } catch (err) {
        console.error('Failed to save Codex config:', err);
        showAdminStudioToast(err.message || '保存 Codex 配置失败', 'error');
        return false;
    }
}

async function saveCodexConfig() {
    const draft = readCodexDraftConfig();
    const validationMessage = validateCodexDraftConfig(draft);

    if (validationMessage) {
        showAdminStudioToast(validationMessage, 'warning');
        focusCodexConfigPanel();
        return false;
    }

    const config = getCodexRuntimeConfig();
    if ((config.source || 'missing') !== 'stored') {
        await promptForCodexKey({
            draft,
            helperText: '首次固化 Codex 中转配置时，需要同时录入 API Key。后续若只切换中转站地址、模型或接口格式，就可以直接点击“保存 Codex 配置”。'
        });
        return null;
    }

    try {
        showAdminStudioToast('正在保存 Codex 配置...', 'info');
        const payload = await saveServerManagedCodexConfig(draft);
        setCodexRuntimeConfig(payload);
        await activateCodexAsCurrentAIService();
        renderApiKeySelector();
        renderCodexConfigPanel();
        showAdminStudioToast(payload.message || 'Codex 配置已更新。', 'success');
        return true;
    } catch (err) {
        console.error('Failed to update Codex config:', err);
        showAdminStudioToast(err.message || '保存 Codex 配置失败', 'error');
        return false;
    }
}

async function deleteCodexConfig() {
    const config = getCodexRuntimeConfig();

    if ((config.source || 'missing') !== 'stored') {
        showAdminStudioToast('当前没有可删除的后台存储 Codex 配置。', 'info');
        return null;
    }

    if (!confirm('确定要删除当前后台安全存储的 Codex 配置吗？')) {
        return null;
    }

    try {
        const payload = await deleteServerManagedCodexConfig();
        setCodexRuntimeConfig(payload);
        renderApiKeySelector();
        renderCodexConfigPanel();
        showAdminStudioToast(payload.message || 'Codex 配置已删除', 'success');
        return true;
    } catch (err) {
        console.error('Failed to delete Codex config:', err);
        showAdminStudioToast(err.message || '删除 Codex 配置失败', 'error');
        return false;
    }
}

async function testCodexConnectivity() {
    const draft = readCodexDraftConfig();
    const validationMessage = validateCodexDraftConfig(draft);

    if (validationMessage) {
        showAdminStudioToast(validationMessage, 'warning');
        focusCodexConfigPanel();
        return null;
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
            return null;
        }

        transientApiKey = String(input || '').trim();
        if (!transientApiKey) {
            showAdminStudioToast('未输入可用于测试的 Codex API Key', 'warning');
            return null;
        }
    }

    try {
        showAdminStudioToast('正在测试 Codex 连通性...', 'info');
        const payload = await testServerManagedCodexConnectivity({
            ...draft,
            ...(transientApiKey ? { apiKey: transientApiKey } : {})
        });
        const responsePreview = String(payload.text || '').trim();
        const detail = responsePreview ? ` 返回：${responsePreview.slice(0, 80)}` : '';
        showAdminStudioToast((payload.message || 'Codex Relay 连通性测试通过。') + detail, 'success');
        return true;
    } catch (err) {
        console.error('Failed to test Codex connectivity:', err);
        showAdminStudioToast(err.message || '测试 Codex 连通性失败', 'error');
        return false;
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
    showAdminStudioToast('当前仅支持一个 Gemini 服务端代理密钥。', 'info');
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
        showAdminStudioToast('Claude 暂未接入后台代理，请先切换到 Gemini 或 Codex Relay。', 'info');
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
window.fetchAiImageAdminConfig = fetchAiImageAdminConfig;
window.fetchAiImageModelConfig = fetchAiImageModelConfig;
window.selectAiImageModelProvider = selectAiImageModelProvider;
window.createAiImageModelProviderDraft = createAiImageModelProviderDraft;
window.handleAiImageModelProviderDraftInput = handleAiImageModelProviderDraftInput;
window.toggleAiImageVisibleModel = toggleAiImageVisibleModel;
window.cloneAiImageModelProvider = cloneAiImageModelProvider;
window.applyAiImageDiscoveredModel = applyAiImageDiscoveredModel;
window.classifyAiImageUnknownModel = classifyAiImageUnknownModel;
window.promptForAiImageModelKey = promptForAiImageModelKey;
window.saveAiImageModelConfig = saveAiImageModelConfig;
window.testAiImageModelConfig = testAiImageModelConfig;
window.discoverAiImageModelConfig = discoverAiImageModelConfig;
window.deleteAiImageModelConfig = deleteAiImageModelConfig;
window.saveAiImageApiBaseUrl = saveAiImageApiBaseUrl;
window.disableAiImageApiBaseUrl = disableAiImageApiBaseUrl;
window.saveAiImageGuardrails = saveAiImageGuardrails;
window.saveAiImageStoragePolicy = saveAiImageStoragePolicy;
window.saveAiImagePricingRule = saveAiImagePricingRule;
window.saveAiImageAgent = saveAiImageAgent;
window.resetAiImagePricingEditor = resetAiImagePricingEditor;
window.selectAiImagePricingRule = selectAiImagePricingRule;
window.deleteAiImagePricingRule = deleteAiImagePricingRule;
window.disableAiImagePricingRule = disableAiImagePricingRule;
window.disableAiImageAgent = disableAiImageAgent;
window.runAiImageWorkerOnce = runAiImageWorkerOnce;
window.renderAiImageAdminPanel = renderAiImageAdminPanel;
window.switchAiCreationView = switchAiCreationView;
window.initAiCreationModule = initAiCreationModule;
window.handleAiCreationSiteChange = handleAiCreationSiteChange;

if (window.AdminShell?.registerModule) {
    window.AdminShell.registerModule('ai-creation', {
        activate: initAiCreationModule,
        handleContext: handleAiCreationShellContext,
        onSiteChange: handleAiCreationSiteChange
    });
}

const aiImageAdminTooltipState = {
    el: null,
    target: null
};

function getAiImageAdminTooltip() {
    if (aiImageAdminTooltipState.el?.isConnected) return aiImageAdminTooltipState.el;
    const el = document.createElement('div');
    el.className = 'ai-image-admin-floating-tooltip';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    aiImageAdminTooltipState.el = el;
    return el;
}

function positionAiImageAdminTooltip(target) {
    const tooltip = aiImageAdminTooltipState.el;
    if (!tooltip || !(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportPadding = 12;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding));
    const top = rect.top >= tooltipRect.height + 14
        ? rect.top - tooltipRect.height - 8
        : rect.bottom + 8;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(Math.max(viewportPadding, top))}px`;
}

function showAiImageAdminTooltip(target) {
    const text = String(target?.dataset?.aiImageTooltip || '').trim();
    if (!text) return;
    const tooltip = getAiImageAdminTooltip();
    aiImageAdminTooltipState.target = target;
    tooltip.textContent = text;
    tooltip.classList.add('is-visible');
    positionAiImageAdminTooltip(target);
}

function hideAiImageAdminTooltip(target = null) {
    if (target && aiImageAdminTooltipState.target && target !== aiImageAdminTooltipState.target) return;
    aiImageAdminTooltipState.target = null;
    aiImageAdminTooltipState.el?.classList.remove('is-visible');
}

function bindAiImageAdminTooltips() {
    document.querySelectorAll('[data-ai-image-tooltip]').forEach((target) => {
        if (!(target instanceof HTMLElement) || target.dataset.aiImageTooltipBound === '1') return;
        target.dataset.aiImageTooltipBound = '1';
        target.addEventListener('mouseenter', () => showAiImageAdminTooltip(target));
        target.addEventListener('focus', () => showAiImageAdminTooltip(target));
        target.addEventListener('mouseleave', () => hideAiImageAdminTooltip(target));
        target.addEventListener('blur', () => hideAiImageAdminTooltip(target));
    });
}

window.addEventListener('scroll', () => hideAiImageAdminTooltip(), true);
window.addEventListener('resize', () => {
    if (aiImageAdminTooltipState.target) {
        positionAiImageAdminTooltip(aiImageAdminTooltipState.target);
    }
});

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
    document.querySelectorAll('.custom-select:not(.points-select)').forEach(dropdown => {
        setupCustomDropdown(dropdown);
    });
}

function setupCustomDropdown(dropdown, onChange) {
    if (!(dropdown instanceof HTMLElement) || dropdown.classList.contains('points-select')) return;

    const display = dropdown.querySelector('.select-display');
    const options = dropdown.querySelectorAll('.select-option');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');

    if (!display || !hiddenInput) return;
    if (display.dataset.adminDropdownBound === '1') return;
    display.dataset.adminDropdownBound = '1';

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
                hiddenInput.dataset.adminDropdownDirty = '1';
                hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
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
    delete hiddenInput.dataset.adminDropdownDirty;

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
        // Single image - normalize again for analysis so the AI payload stays comfortably below gateway limits.
        return normalizeImageForAnalysis(images[0]);
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
        const cellSize = ADMIN_VISION_GRID_CELL_SIZE;
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
                        base64: webpDataUrl.split(',')[1],
                        mimeType: 'image/webp'
                    });
                }
            };
            img.onerror = () => reject(new Error('Failed to load image for grid'));
            img.src = imgData.dataUrl;
        });
    });
}

async function normalizeImageForAnalysis(imageData) {
    const fallback = {
        dataUrl: imageData?.dataUrl || '',
        base64: imageData?.base64 || '',
        mimeType: String(imageData?.mimeType || '').trim()
            || String(imageData?.dataUrl || '').match(/^data:([^;,]+)/)?.[1]
            || 'image/jpeg'
    };

    if (!fallback.dataUrl || !fallback.base64) {
        return fallback;
    }

    try {
        const normalized = await convertToWebP(
            fallback.dataUrl,
            ADMIN_VISION_SINGLE_IMAGE_QUALITY,
            ADMIN_VISION_SINGLE_IMAGE_MAX_WIDTH
        );
        return normalized?.dataUrl && normalized?.base64
            ? {
                ...normalized,
                mimeType: 'image/webp'
            }
            : fallback;
    } catch (error) {
        console.warn('Failed to normalize analysis image payload:', error);
        return fallback;
    }
}

// ========================================
// UPLOAD ZONE
// ========================================
function initUploadZone() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    if (!uploadZone || !fileInput || uploadZone.dataset.uploadZoneBound === '1') {
        return;
    }

    uploadZone.dataset.uploadZoneBound = '1';

    // Click to upload
    uploadZone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
        void handleFiles(e.target.files);
        e.target.value = '';
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
        void handleFiles(e.dataTransfer.files);
    });
}

function getUploadedFileFingerprint(file) {
    if (!file) return '';
    return [
        file.name || 'image',
        file.size || 0,
        file.lastModified || 0,
        file.type || ''
    ].join(':');
}

function hasUploadedFileFingerprint(fingerprint) {
    if (!fingerprint) return false;
    if (pendingUploadFileFingerprints.has(fingerprint)) return true;
    return uploadedFiles.some((item) => item?.fingerprint === fingerprint);
}

async function handleFiles(files) {
    const validFiles = Array.from(files).filter(file =>
        file.type.startsWith('image/')
    );

    if (validFiles.length === 0) {
        showAdminStudioToast('请上传图片文件', 'error');
        return;
    }

    for (const file of validFiles) {
        const fingerprint = getUploadedFileFingerprint(file);
        if (hasUploadedFileFingerprint(fingerprint)) {
            console.warn('Skipping duplicate uploaded image:', file.name);
            continue;
        }
        pendingUploadFileFingerprints.add(fingerprint);
        const reader = new FileReader();

        await new Promise((resolve) => {
            reader.onload = async (e) => {
                try {
                    // Convert to WebP automatically. Keep a high-resolution original for detail views.
                    const webp = await convertToWebP(
                        e.target.result,
                        PROMPT_UPLOAD_ORIGINAL_QUALITY,
                        PROMPT_UPLOAD_ORIGINAL_MAX_WIDTH
                    );

                    uploadedFiles.push({
                        file: file,               // Keep original file reference
                        dataUrl: webp.dataUrl,    // Use WebP for display
                        base64: webp.base64,      // Use WebP for upload
                        fingerprint,
                        originalDataUrl: e.target.result  // Preserve original
                    });

                    console.log(`✅ Converted ${file.name} to WebP`);
                } catch (err) {
                    console.warn('WebP conversion failed, using original:', err);
                    // Fallback to original if WebP conversion fails
                    uploadedFiles.push({
                        file: file,
                        dataUrl: e.target.result,
                        base64: e.target.result.split(',')[1],
                        fingerprint
                    });
                }

                renderPreviews();
                updateAnalyzeButton();
                pendingUploadFileFingerprints.delete(fingerprint);
                resolve();
            };
            reader.onerror = () => {
                pendingUploadFileFingerprints.delete(fingerprint);
                resolve();
            };
            reader.readAsDataURL(file);
        });
    }
}

function buildPreviewGridMarkup(items, options = {}) {
    const removable = options.removable !== false;
    const croppable = options.croppable !== false;

    return items.map((item, index) => {
        const imageSrc = item?.dataUrl || item?.url || '';
        const cropButton = croppable
            ? `
                <button class="preview-action-btn preview-crop-btn" type="button" data-admin-action="ai-crop-preview" data-preview-index="${index}" title="裁切图片">
                    <i class="fas fa-crop-alt"></i>
                </button>
            `
            : '';
        const removeButton = removable
            ? `
                <button class="remove-btn" type="button" data-admin-action="ai-remove-preview" data-preview-index="${index}" title="移除图片">
                    <i class="fas fa-times"></i>
                </button>
            `
            : '';

        return `
            <div class="preview-item" data-index="${index}" tabindex="0" role="button" aria-label="预览图片 ${index + 1}">
                <img src="${imageSrc}" alt="Preview ${index + 1}">
                ${cropButton}
                ${removeButton}
            </div>
        `;
    }).join('');
}

function renderPreviewGridItems(items, options = {}) {
    const grid = document.getElementById('previewGrid');
    if (!grid) {
        return;
    }
    grid.innerHTML = buildPreviewGridMarkup(items, options);
}

function renderPreviews() {
    renderPreviewGridItems(uploadedFiles, { removable: true, croppable: true });
}

function syncGalleryAnalyzeButtonLabel(mode = currentMode) {
    const btn = document.getElementById('analyzeBtn');
    if (!btn) {
        return;
    }

    const isEditMode = mode === 'edit';
    const nextLabel = isEditMode ? '重新分析元数据' : 'Analyze';
    btn.textContent = nextLabel;
    btn.setAttribute('aria-label', nextLabel);
    btn.dataset.mode = isEditMode ? 'edit' : 'create';
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    if (currentMode === 'edit' && index >= 0 && index < currentEditingPromptImageUrls.length) {
        currentEditingPromptImageUrls.splice(index, 1);
        if (typeof currentEditingPromptImageAssets !== 'undefined' && Array.isArray(currentEditingPromptImageAssets)) {
            currentEditingPromptImageAssets.splice(index, 1);
        }
    }
    renderPreviews();
    updateAnalyzeButton();
}

function updateAnalyzeButton() {
    const btn = document.getElementById('analyzeBtn');
    if (!btn) {
        return;
    }

    syncGalleryAnalyzeButtonLabel(currentMode);

    const hasAnalysisSourceImages = uploadedFiles.length > 0
        || (currentMode === 'edit' && currentEditingPromptImageUrls.length > 0);
    btn.disabled = !hasAnalysisSourceImages || !window.AdminAI?.configured;
}

async function hydrateEditingImagesForAnalysis() {
    if (currentMode !== 'edit') {
        return 0;
    }

    if (!currentEditingPromptImageUrls.length && Array.isArray(currentEditingPromptImageAssets) && currentEditingPromptImageAssets.length) {
        currentEditingPromptImageUrls = getPromptImageUrlsFromAssets(currentEditingPromptImageAssets);
    }

    if (currentEditingPromptImageUrls.length === 0) {
        return 0;
    }

    uploadedFiles = [];

    for (const imageUrl of currentEditingPromptImageUrls) {
        try {
            const imageData = await getImageBase64ForAnalysis(imageUrl);
            const mimeType = imageData.mimeType || 'image/jpeg';
            uploadedFiles.push({
                file: null,
                dataUrl: `data:${mimeType};base64,${imageData.base64}`,
                base64: imageData.base64,
                url: imageUrl
            });
        } catch (error) {
            console.warn('Failed to hydrate editing image for analysis:', imageUrl, error);
        }
    }

    updateAnalyzeButton();
    return uploadedFiles.length;
}

// ========================================
// GEMINI AI ANALYSIS
// ========================================
document.getElementById('analyzeBtn').addEventListener('click', analyzeImages);

async function analyzeImages(options = {}) {
    const settings = options instanceof Event || !options || typeof options !== 'object'
        ? {}
        : options;
    if (uploadedFiles.length === 0 && currentMode === 'edit') {
        await hydrateEditingImagesForAnalysis();
    }
    if (uploadedFiles.length === 0) {
        if (currentMode === 'edit') {
            showAdminStudioToast('无法读取当前图片用于重分析，请重新上传图片后再试', 'error');
        }
        return;
    }

    if (!window.AdminAI?.configured) {
        showAdminStudioToast(getCurrentAIMissingConfigMessage(), 'error');
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

        const result = await callAdminVision(gridImage.base64, gridImage.mimeType || 'image/webp');

        analysisResult = result;
        populateForm(result, {
            preserveExisting: Boolean(settings.preserveExisting),
            source: 'analysis'
        });

        setAdminStudioVisibility(loadingEl, false);
        setAdminStudioVisibility(formEl, true);
        updateStatus(settings.completeStatusText || 'Analysis Complete', 'ready');
        if (!settings.silentSuccessToast) {
            showAdminStudioToast(`AI 分析完成！(${imageCount} 张图片)`, 'success');
        }
        return result;

    } catch (error) {
        console.error('Analysis error:', error);
        setAdminStudioVisibility(loadingEl, false);
        showAdminStudioToast(`分析失败: ${error.message}`, 'error');
        await checkApiKey();
        if (settings.rethrow) {
            throw error;
        }
        return null;
    } finally {
        btn.disabled = false;
    }
}

async function callAdminVision(imageBase64, mimeType = 'image/jpeg') {
    const analysisPrompt = `Analyze this AI-generated art image for an admin prompt gallery and return ONLY valid JSON.

{
    "title": "Creative English title, 2-5 words",
    "title_en": "Same as title",
    "title_zh": "自然中文标题",
    "category": "One of: Photography, Illustration, 3D Art, Miniature, Creative, Animation",
    "description": "One short English sentence",
    "description_en": "Same as description",
    "description_zh": "一句自然中文描述",
    "objects": {
        "en": ["6-10 visible objects or subjects"],
        "zh": ["对应的中文翻译"]
    },
    "scenes": {
        "en": ["5-8 scene or environment descriptors"],
        "zh": ["对应的中文翻译"]
    },
    "styles": {
        "en": ["6-10 art style descriptors"],
        "zh": ["对应的中文翻译"]
    },
    "mood": {
        "en": ["5-8 mood or atmosphere words"],
        "zh": ["对应的中文翻译"]
    },
    "useCase": {
        "platform": ["2-4 relevant creation platforms or model families"],
        "purpose": ["3-5 practical use cases"],
        "format": ["2-4 deliverable or content formats"]
    },
    "commercial": {
        "niche": ["2-4 commercial niches or business scenarios"],
        "targetAudience": ["2-4 likely target audiences"]
    },
    "difficulty": "beginner | intermediate | advanced",
    "dominantColors": ["3-4 English color names"]
}

Rules:
- Keep every array compact, searchable, and aligned 1:1 between English and Chinese.
- Prefer concrete tags over poetic paragraphs.
- Do not repeat near-duplicates such as singular/plural or trivial synonyms.
- For useCase/commercial fields, return short English phrases only.
- Difficulty must be exactly one of: beginner, intermediate, advanced.
- Return JSON only. No markdown, no code fence, no explanation.`;

    const requestPayload = {
        model: window.AdminAI?.defaultModel || DEFAULT_ADMIN_VISION_MODEL,
        contents: [{
            parts: [
                { text: analysisPrompt },
                {
                    inline_data: {
                        mime_type: mimeType || 'image/jpeg',
                        data: imageBase64
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.35,
            maxOutputTokens: ADMIN_VISION_ANALYSIS_MAX_OUTPUT_TOKENS
        },
        budget: {
            tier: 'balanced',
            maxInputChars: 12000,
            maxOutputTokens: ADMIN_VISION_ANALYSIS_MAX_OUTPUT_TOKENS
        }
    };

    let response = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            response = await withTimeout(
                window.AdminAI.generate(requestPayload),
                ADMIN_VISION_ANALYSIS_TIMEOUT_MS,
                'AI 分析超时，请稍后重试'
            );
            lastError = null;
            break;
        } catch (error) {
            lastError = error;
            const shouldRetry = attempt < 2 && isRetryableVisionError(error);
            if (!shouldRetry) {
                throw error;
            }
            await sleep(900 * attempt);
        }
    }

    if (!response && lastError) {
        throw lastError;
    }

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

function isRetryableVisionError(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    const message = String(error?.message || '').trim().toLowerCase();

    return ADMIN_VISION_RETRYABLE_STATUS_CODES.has(status)
        || message.includes('bad gateway')
        || message.includes('gateway')
        || message.includes('timeout')
        || message.includes('timed out')
        || message.includes('fetch failed')
        || message.includes('network');
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

function normalizePromptSourceAuthorHandle(value = '') {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function populatePromptSourceFields(data = {}) {
    const sourceUrlInput = document.getElementById('promptSourceUrl');
    const authorNameInput = document.getElementById('promptSourceAuthorName');
    const authorHandleInput = document.getElementById('promptSourceAuthorHandle');

    if (sourceUrlInput) sourceUrlInput.value = data.source_url || data.sourceUrl || '';
    if (authorNameInput) authorNameInput.value = data.source_author_name || data.sourceAuthorName || '';
    if (authorHandleInput) authorHandleInput.value = data.source_author_handle || data.sourceAuthorHandle || '';
}

function collectPromptSourceFieldValues() {
    return {
        source_url: document.getElementById('promptSourceUrl')?.value.trim() || '',
        source_author_name: document.getElementById('promptSourceAuthorName')?.value.trim() || '',
        source_author_handle: normalizePromptSourceAuthorHandle(document.getElementById('promptSourceAuthorHandle')?.value || '')
    };
}

function resetPromptSourceFields() {
    populatePromptSourceFields({});
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
    const existingAdmin = nextAiTags.admin && typeof nextAiTags.admin === 'object' && !Array.isArray(nextAiTags.admin)
        ? clonePromptAiTags(nextAiTags.admin)
        : {};

    if (analysisData) {
        nextAiTags.objects = analysisData.objects;
        nextAiTags.scenes = analysisData.scenes;
        nextAiTags.styles = analysisData.styles;
        nextAiTags.mood = analysisData.mood;
        nextAiTags.useCase = analysisData.useCase || {};
        nextAiTags.commercial = analysisData.commercial || {};
        nextAiTags.difficulty = analysisData.difficulty || '';
    }

    const preservedAdminMetadata = Object.fromEntries(
        Object.entries(existingAdmin).filter(([key]) => !['status', 'note'].includes(key))
    );
    if (adminOps.status || adminOps.note || Object.keys(preservedAdminMetadata).length > 0) {
        nextAiTags.admin = {
            ...preservedAdminMetadata,
            ...adminOps
        };
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
        source: collectPromptSourceFieldValues(),
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
    const source = String(options.source || 'record').trim().toLowerCase();
    const isAnalysisSource = source === 'analysis';
    const currentForm = getPromptFormSnapshot();
    let resolvedPrimaryFields = resolvePromptPrimaryFields(preserveExisting ? currentForm : {}, data || {});

    if (isAnalysisSource) {
        resolvedPrimaryFields = {
            ...resolvedPrimaryFields,
            promptText: promptHasVisibleCopy(currentForm?.prompt) ? currentForm.prompt : ''
        };
    }

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
        prompt_text_zh: (isAnalysisSource || preserveExisting) && promptHasVisibleCopy(currentForm?.bilingual?.prompt_text_zh)
            ? currentForm.bilingual.prompt_text_zh
            : (isAnalysisSource ? '' : (data.prompt_text_zh || '')),
        prompt_text_en: (isAnalysisSource || preserveExisting) && promptHasVisibleCopy(currentForm?.bilingual?.prompt_text_en)
            ? currentForm.bilingual.prompt_text_en
            : (isAnalysisSource ? '' : (data.prompt_text_en || ''))
    };

    populatePromptBilingualFields(nextBilingualValues);
    setPromptBilingualFieldsOpen(hasPromptBilingualContent(nextBilingualValues));
    populatePromptSourceFields({
        source_url: preserveExisting && promptHasVisibleCopy(currentForm?.source?.source_url)
            ? currentForm.source.source_url
            : (data.source_url || ''),
        source_author_name: preserveExisting && promptHasVisibleCopy(currentForm?.source?.source_author_name)
            ? currentForm.source.source_author_name
            : (data.source_author_name || ''),
        source_author_handle: preserveExisting && promptHasVisibleCopy(currentForm?.source?.source_author_handle)
            ? currentForm.source.source_author_handle
            : (data.source_author_handle || '')
    });
    populatePromptOpsFields({
        status: preserveExisting && currentForm?.opsStatus ? currentForm.opsStatus : (data.opsStatus || ''),
        note: preserveExisting && currentForm?.opsNote ? currentForm.opsNote : (data.opsNote || '')
    });

    // Tags
    renderTags('tagObjects', data.objects);
    renderTags('tagScenes', data.scenes);
    renderTags('tagStyles', data.styles);
    renderTags('tagMood', data.mood);
    if (typeof renderSimpleTags === 'function') {
        renderSimpleTags('tagUseCasePlatform', data.useCase?.platform);
        renderSimpleTags('tagUseCasePurpose', data.useCase?.purpose);
        renderSimpleTags('tagUseCaseFormat', data.useCase?.format);
        renderSimpleTags('tagCommercialNiche', data.commercial?.niche);
        renderSimpleTags('tagCommercialAudience', data.commercial?.targetAudience);
        renderSimpleTags('tagDifficulty', data.difficulty ? [data.difficulty] : []);
    }

    // Colors
    renderColors(data.dominantColors || []);
}

function renderTags(containerId, tagData) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }
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

function normalizeAdminPromptTagList(values = []) {
    if (!Array.isArray(values)) {
        return [];
    }

    const seen = new Set();
    return values
        .map((value) => String(value || '').trim())
        .filter((value) => {
            const key = value.toLowerCase();
            if (!key || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
}

function renderSimpleTags(containerId, values = []) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    const tags = normalizeAdminPromptTagList(values);
    if (tags.length === 0) {
        container.replaceChildren(createAdminStudioEmptyElement('No tags', 'admin-empty-tag', 'span'));
        return;
    }

    container.innerHTML = tags.map((tag) => `
        <span class="tag-item">${escapeHtml(tag)}</span>
    `).join('');
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
            showAdminStudioToast('请先上传图片', 'error');
            return;
        }
        if (!activeAnalysisResult) {
            showAdminStudioToast('未检测到分析结果，正在自动分析并保存...', 'warning');
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
            showAdminStudioToast('请确保有图片', 'error');
            return;
        }
    }

    const saveBtn = document.getElementById('saveBtn');
    const saveStatusLabel = currentMode === 'edit' ? 'Updating...' : 'Saving...';
    syncGallerySaveButtonState(currentMode);

    // Start saving animation
    saveBtn.classList.remove('saved');
    saveBtn.classList.add('saving');
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    saveBtn.setAttribute('aria-label', currentMode === 'edit' ? 'Updating Prompt' : 'Saving Prompt');
    updateStatus(saveStatusLabel, 'processing');

    try {
        // Get form values
        const formValues = getPromptFormSnapshot();
        const resolvedPrimaryFields = resolvePromptPrimaryFields(formValues, activeAnalysisResult || {});
        let title = resolvedPrimaryFields.title;
        let category = resolvedPrimaryFields.category;
        const promptText = formValues.prompt;
        const description = resolvedPrimaryFields.description;
        const bilingualValues = collectPromptBilingualFieldValues();
        const sourceValues = collectPromptSourceFieldValues();
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

        // Upload images to R2/CDN. Supabase Storage fallback is intentionally disabled.
        let imageUrls = [];
        let imageAssets = [];
        let storageAvailable = true;
        const retainedEditingImageUrls = currentMode === 'edit'
            ? currentEditingPromptImageUrls.map((url) => String(url || '').trim()).filter(Boolean)
            : [];
        const retainedEditingImageAssets = currentMode === 'edit'
            ? dedupePromptImageAssets(currentEditingPromptImageAssets)
            : [];

        try {
            if (uploadedFiles.length === 0 && retainedEditingImageUrls.length > 0) {
                imageUrls = retainedEditingImageUrls;
                imageAssets = retainedEditingImageAssets.length > 0
                    ? retainedEditingImageAssets
                    : retainedEditingImageUrls.map((url) => ({ original: url }));
            } else {
                const uploadResult = await uploadImages();
                imageUrls = uploadResult.urls;
                imageAssets = uploadResult.assets;
            }
        } catch (imageUploadError) {
            console.warn('R2 image upload failed:', imageUploadError);
            if (currentMode !== 'edit' || retainedEditingImageUrls.length === 0) {
                throw imageUploadError;
            }
            storageAvailable = false;
            // Keep existing images when a new R2 upload fails in edit mode.
            imageUrls = retainedEditingImageUrls;
            imageAssets = retainedEditingImageAssets;
        }

        // Create prompt object
        // In edit mode without new analysis, preserve existing values by not including them
        const promptData = {
            title: title,
            tags: [category],
            description: description,
            prompt: promptText,
            images: imageUrls,
            image_assets: imageAssets,
            ...sourceValues,
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
        }

        const promptTextLooksChinese = isAdminPromptMostlyCjkText(promptData.prompt || '');
        if (!promptTextLooksChinese && promptData.prompt) {
            promptData.prompt_text_en = promptData.prompt;
            const promptTextEnInput = document.getElementById('promptTextEn');
            if (promptTextEnInput) {
                promptTextEnInput.value = promptData.prompt;
            }
        }

        // Auto-seed and translate missing bilingual fields using PromptTranslator.
        // Prompt text stays manual; only title/description participate in the auto bilingual flow.
        let translationSoftFailed = false;
        const bilingualCoverageInput = {
            title: promptData.title,
            description: promptData.description,
            title_zh: promptData.title_zh,
            title_en: promptData.title_en,
            description_zh: promptData.description_zh,
            description_en: promptData.description_en
        };

        if (window.PromptTranslator?.seedCoverageFields) {
            const seededCoverageFields = PromptTranslator.seedCoverageFields(bilingualCoverageInput);
            promptData.title_zh = promptData.title_zh || seededCoverageFields.title_zh || '';
            promptData.title_en = promptData.title_en || seededCoverageFields.title_en || '';
            promptData.description_zh = promptData.description_zh || seededCoverageFields.description_zh || '';
            promptData.description_en = promptData.description_en || seededCoverageFields.description_en || '';
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
                    title_zh: promptData.title_zh,
                    title_en: promptData.title_en,
                    description_zh: promptData.description_zh,
                    description_en: promptData.description_en
                }, { mode: 'full' });

                promptData.title_zh = promptData.title_zh || translatedFields.title_zh || '';
                promptData.title_en = promptData.title_en || translatedFields.title_en || '';
                promptData.description_zh = promptData.description_zh || translatedFields.description_zh || '';
                promptData.description_en = promptData.description_en || translatedFields.description_en || '';

                console.log('[Gallery] Auto-translation complete:', {
                    title_zh: promptData.title_zh,
                    title_en: promptData.title_en,
                    description_zh: promptData.description_zh,
                    description_en: promptData.description_en
                });
                updateStatus(saveStatusLabel, 'processing');
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
        let missingPersistedSourceAttributionFields = [];
        let bilingualPersistenceState = {
            row: null,
            missingFields: [],
            schemaMissing: false,
            verificationError: null
        };
        let sourceAttributionPersistenceState = {
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
            prompt_text_zh: promptData.prompt_text_zh || '',
            source_url: promptData.source_url || '',
            source_author_name: promptData.source_author_name || '',
            source_author_handle: promptData.source_author_handle || ''
        };

        if (storageAvailable) {
            promptPayload.images = promptData.images;
            promptPayload.image_assets = promptData.image_assets;
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
                    image_assets: promptData.image_assets,
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
        sourceAttributionPersistenceState = await verifyPromptPersistedSourceAttributionFields(savedPromptId, promptPayload, savedRow);
        savedRow = sourceAttributionPersistenceState.row || savedRow;
        missingPersistedSourceAttributionFields = sourceAttributionPersistenceState.missingFields;

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
        markHomepagePromptPoolUpdated();

        const successMsg = currentMode === 'edit' ? 'Prompt updated!' : 'Prompt saved!';
        showAdminStudioToast(successMsg, 'success');

        const savedCoverage = getPromptLanguageCoverage(savedRow);
        const bilingualPersistenceWarning = buildPromptBilingualPersistenceWarningMessage(
            missingPersistedBilingualFields,
            bilingualPersistenceState
        );
        if (bilingualPersistenceWarning) {
            showAdminStudioToast(bilingualPersistenceWarning, 'warning');
        } else if (!savedCoverage.zh || !savedCoverage.en || translationSoftFailed) {
            showAdminStudioToast('Prompt 已保存，但双语仍未补全。可在高级语言字段中继续校对补齐。', 'warning');
        }

        const sourceAttributionPersistenceWarning = buildPromptSourceAttributionPersistenceWarningMessage(
            missingPersistedSourceAttributionFields,
            sourceAttributionPersistenceState
        );
        if (sourceAttributionPersistenceWarning) {
            showAdminStudioToast(sourceAttributionPersistenceWarning, 'warning');
        }

        // Reset edit mode
        if (currentMode === 'edit') {
            cancelEdit();
        }

        // Success state
        setTimeout(() => {
            saveBtn.classList.remove('saving');
            saveBtn.classList.add('saved');
            saveBtn.setAttribute('aria-busy', 'false');
            saveBtn.setAttribute('aria-label', 'Saved');
            saveBtn.querySelector('.btn-text').innerHTML = buildGallerySaveButtonMarkup('Saved!', 'fas fa-check');
            updateStatus('Saved', 'ready');
            showAdminStudioToast('Prompt 已保存到数据库！', 'success');

            // Reset button after delay
            setTimeout(() => {
                saveBtn.classList.remove('saved');
                syncGallerySaveButtonState(currentMode);
                saveBtn.disabled = false;
            }, 2000);
        }, 400);

    } catch (error) {
        console.error('Save error:', error);
        showAdminStudioToast(`保存失败: ${error.message}`, 'error');
        updateStatus('Error', 'error');

        // Reset button
        saveBtn.classList.remove('saving');
        saveBtn.setAttribute('aria-busy', 'false');
        syncGallerySaveButtonState(currentMode);
        saveBtn.disabled = false;
    }
}

// ========================================
// SAVE BUTTON FEEDBACK
// ========================================
/**
 * Generate a resized WebP image variant from base64 image data.
 * @param {string} base64 - Original image base64 (without data: prefix)
 * @param {number} maxWidth - Maximum width for the generated variant
 * @param {number} quality - WebP quality 0-1
 * @returns {Promise<string>} - Variant base64 (without data: prefix)
 */
async function generatePromptImageVariant(base64, maxWidth = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const safeMaxWidth = Math.max(Number.parseInt(maxWidth, 10) || 800, 1);
            const targetWidth = Math.min(img.width, safeMaxWidth);
            const ratio = targetWidth / img.width;
            canvas.width = targetWidth;
            canvas.height = Math.round(img.height * ratio);

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const thumbnailDataUrl = canvas.toDataURL('image/webp', quality);
            const thumbnailBase64 = thumbnailDataUrl.split(',')[1];
            resolve(thumbnailBase64);
        };
        img.onerror = () => reject(new Error('Failed to load image for variant generation'));
        img.src = `data:image/webp;base64,${base64}`;
    });
}

async function generateThumbnail(base64, maxWidth = 800, quality = 0.85) {
    return generatePromptImageVariant(base64, maxWidth, quality);
}

function getUploadedImagePayloadFingerprint(item = {}) {
    const explicitFingerprint = String(item?.fingerprint || '').trim();
    if (explicitFingerprint) {
        return explicitFingerprint;
    }

    const base64 = String(item?.base64 || '');
    if (base64) {
        return [
            base64.length,
            base64.slice(0, 96),
            base64.slice(-96)
        ].join(':');
    }

    return String(item?.url || '').trim();
}

async function uploadImages() {
    const urls = [];
    const assets = [];
    const imagesToUpload = [];
    const uploadedPayloadFingerprints = new Set();
    const variantUploadsEnabled = window.__ENABLE_PROMPT_R2_DELIVERY_VARIANTS__ === true;

    for (let i = 0; i < uploadedFiles.length; i++) {
        const item = uploadedFiles[i];
        const payloadFingerprint = getUploadedImagePayloadFingerprint(item);
        if (payloadFingerprint && uploadedPayloadFingerprints.has(payloadFingerprint)) {
            console.warn(`⚠️ Skipping duplicate image payload at index ${i}`);
            continue;
        }
        if (payloadFingerprint) {
            uploadedPayloadFingerprints.add(payloadFingerprint);
        }

        // If item already has a public URL (existing image in edit mode), just use it
        if (item.url && item.url.startsWith('http')) {
            const retainedAsset = normalizePromptImageAsset(
                item.asset || currentEditingPromptImageAssets[i] || item.url
            ) || { original: item.url };
            urls.push(getPromptImageAssetOriginalUrl(retainedAsset));
            assets.push(retainedAsset);
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
            variant: 'original',
            isThumb: false
        });

        // Generate safe delivery variants. Keep card/home disabled until the deployed Edge Function supports variant paths.
        const variantsToUpload = PROMPT_UPLOAD_IMAGE_VARIANTS.filter((variant) => (
            variantUploadsEnabled || PROMPT_UPLOAD_SAFE_VARIANT_IDS.has(variant.id)
        ));
        for (const variant of variantsToUpload) {
            try {
                const variantBase64 = await generatePromptImageVariant(base64, variant.maxWidth, variant.quality);
                imagesToUpload.push({
                    base64: variantBase64,
                    filename: fileName,
                    variant: variant.id,
                    isThumb: variant.id === 'thumb'
                });
                console.log(`🖼️ Generated ${variant.id} variant for: ${fileName}`);
            } catch (variantError) {
                console.warn(`⚠️ Failed to generate ${variant.id} variant for ${fileName}:`, variantError);
                // Continue without this variant.
            }
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
            const resultUrls = dedupePromptImageUrls(result.urls);
            urls.push(...resultUrls);
            assets.push(...dedupePromptImageAssets(result.assets));
            const assetOriginals = new Set(
                assets.map((asset) => getPromptImageAssetOriginalUrl(asset)).filter(Boolean)
            );
            for (const url of resultUrls) {
                if (!assetOriginals.has(url)) {
                    assets.push({ original: url });
                    assetOriginals.add(url);
                }
            }

            console.log(`✅ Successfully uploaded ${resultUrls.length} images to R2 CDN`);
            resultUrls.forEach((url, idx) => {
                console.log(`   ${idx + 1}. ${url}`);
            });

        } catch (r2Error) {
            console.error('❌ R2 upload failed:', r2Error);
            throw new Error(`R2 image upload failed; Supabase Storage fallback is disabled: ${r2Error.message || r2Error}`);
        }
    }

    const dedupedUrls = dedupePromptImageUrls(urls);
    const dedupedAssets = dedupePromptImageAssets(assets);
    const assetOriginals = new Set(
        dedupedAssets.map((asset) => getPromptImageAssetOriginalUrl(asset)).filter(Boolean)
    );
    for (const url of dedupedUrls) {
        if (!assetOriginals.has(url)) {
            dedupedAssets.push({ original: url });
            assetOriginals.add(url);
        }
    }

    return {
        urls: dedupedUrls,
        assets: dedupedAssets
    };
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
        showAdminStudioToast('代码已复制到剪贴板！可粘贴到 prompts-data.js', 'success');
    });
}

// ========================================
// UTILITIES
// ========================================
function normalizeAdminStudioFeedbackState(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'processing' || normalized === 'loading' || normalized === 'info' || normalized === 'pending') {
        return 'loading';
    }
    if (normalized === 'success' || normalized === 'saved' || normalized === 'done' || normalized === 'complete') {
        return 'saved';
    }
    if (normalized === 'warning' || normalized === 'partial') {
        return 'partial';
    }
    if (normalized === 'error' || normalized === 'failed' || normalized === 'danger') {
        return 'failed';
    }
    return 'ready';
}

function getAdminStudioActiveModuleId() {
    return String(
        window.AdminShell?.getActiveModuleId?.()
        || document.querySelector('.module-container.active')?.id?.replace(/^module-/, '')
        || document.querySelector('.sidebar-item.active[data-module]')?.dataset?.module
        || 'gallery'
    ).trim().toLowerCase() || 'gallery';
}

function dispatchAdminStudioFeedbackSignal(detail = {}) {
    const payload = {
        kind: String(detail?.kind || 'status').trim().toLowerCase() || 'status',
        source: String(detail?.source || 'admin-studio').trim().toLowerCase() || 'admin-studio',
        state: normalizeAdminStudioFeedbackState(detail?.state || detail?.tone || detail?.type || ''),
        tone: String(detail?.tone || detail?.type || '').trim().toLowerCase() || '',
        message: String(detail?.message ?? '').trim(),
        module: String(detail?.module || getAdminStudioActiveModuleId()).trim().toLowerCase() || 'gallery',
        persistent: Boolean(detail?.persistent),
        timestamp: Number(detail?.timestamp || Date.now()) || Date.now()
    };

    if (!payload.message) {
        return payload;
    }

    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('admin-feedback-signal', {
                detail: payload
            }));
        } catch (_) {
            // Ignore event bus failures so the UI flow can continue.
        }
    }

    return payload;
}

window.dispatchAdminStudioFeedbackSignal = dispatchAdminStudioFeedbackSignal;

function updateStatus(text, state) {
    const statusEl = document.getElementById('studioStatus');
    if (!statusEl) return;
    const dot = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');
    const normalizedState = normalizeAdminStudioFeedbackState(state);

    textEl.textContent = text;
    dot.className = 'status-dot';
    statusEl.dataset.feedbackState = normalizedState;
    if (normalizedState === 'loading') dot.classList.add('processing');
    if (normalizedState === 'partial') dot.classList.add('warning');
    if (normalizedState === 'failed') dot.classList.add('error');

    // Make status clickable when AI proxy is unavailable
    if (normalizedState === 'failed' && /missing$/i.test(String(text || ''))) {
        statusEl.classList.add('clickable');
        statusEl.title = '点击查看当前 AI 服务配置';
        statusEl.onclick = () => openCurrentAIConfigEntry();
    } else {
        statusEl.classList.remove('clickable');
        statusEl.title = '';
        statusEl.onclick = null;
    }

    dispatchAdminStudioFeedbackSignal({
        kind: 'status',
        source: 'studio-header',
        state: normalizedState,
        message: String(text || '').trim(),
        module: getAdminStudioActiveModuleId()
    });
}

function setToastContent(toast, message, type = 'info') {
    if (!toast) return;
    const toastTypeClasses = ['info', 'success', 'warning', 'error'];
    const normalizedType = toastTypeClasses.includes(type) ? type : 'info';
    const shouldAnimateContent = toast.isConnected && toast.childElementCount > 0 && toast.dataset?.dismissing !== 'true';
    const feedbackState = normalizeAdminStudioFeedbackState(normalizedType);

    if (toast.classList) {
        toast.classList.add('toast');
        toastTypeClasses.forEach((typeClass) => {
            toast.classList.toggle(typeClass, typeClass === normalizedType);
        });
    } else {
        toast.className = `toast ${normalizedType}`;
    }
    if (toast.dataset) {
        toast.dataset.toastType = normalizedType;
        toast.dataset.feedbackState = feedbackState;
    }

    const icon = document.createElement('i');
    icon.className = `fas fa-${normalizedType === 'success' ? 'check-circle' : normalizedType === 'error' ? 'exclamation-circle' : normalizedType === 'warning' ? 'triangle-exclamation' : 'info-circle'}`;
    const content = document.createElement('div');
    content.className = 'toast__content';

    const text = document.createElement('span');
    text.className = 'toast__message';
    text.textContent = String(message ?? '');

    content.append(text);
    toast.replaceChildren(icon, content);
    toast.title = String(message ?? '');

    if (shouldAnimateContent) {
        toast.classList.remove('is-content-entering');
        void toast.offsetWidth;
        toast.classList.add('is-content-entering');
        clearTimeout(toast._contentAnimationTimer);
        toast._contentAnimationTimer = setTimeout(() => {
            toast.classList.remove('is-content-entering');
            toast._contentAnimationTimer = null;
        }, 240);
    }
}

function dismissToast(toast) {
    if (!toast || toast.dataset.dismissing === 'true') return;
    toast.dataset.dismissing = 'true';
    if (toast._dismissTimer) {
        clearTimeout(toast._dismissTimer);
        toast._dismissTimer = null;
    }
    if (toast._contentAnimationTimer) {
        clearTimeout(toast._contentAnimationTimer);
        toast._contentAnimationTimer = null;
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

function showAdminStudioToast(message, type = 'info', options = {}) {
    const container = document.getElementById('toastContainer');
    const normalizedType = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';
    const durationMs = Number.isFinite(Number(options?.durationMs)) ? Number(options.durationMs) : 3000;

    if (options?.feedback !== false) {
        dispatchAdminStudioFeedbackSignal({
            kind: 'toast',
            source: 'toast',
            state: normalizeAdminStudioFeedbackState(normalizedType),
            tone: normalizedType,
            message: String(message ?? '').trim(),
            module: getAdminStudioActiveModuleId(),
            persistent: durationMs <= 0
        });
    }

    if (!container) {
        return null;
    }

    const toast = document.createElement('div');
    setToastContent(toast, message, normalizedType);
    container.appendChild(toast);
    scheduleToastDismiss(toast, durationMs);
    return toast;
}

window.showToast = showAdminStudioToast;

function isAdminStudioActionFeedbackButton(button) {
    return Boolean(button && typeof button === 'object' && button.nodeType === 1 && button.tagName === 'BUTTON');
}

function normalizeAdminStudioActionFeedbackText(value = '', fallback = '处理中...') {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function clearAdminStudioActionFeedbackTimer(button) {
    if (!button?._adminStudioActionFeedbackRestoreTimer) {
        return;
    }
    window.clearTimeout(button._adminStudioActionFeedbackRestoreTimer);
    button._adminStudioActionFeedbackRestoreTimer = null;
}

function ensureAdminStudioActionFeedbackSnapshot(button) {
    if (!isAdminStudioActionFeedbackButton(button)) {
        return null;
    }

    if (!button._adminStudioActionFeedbackSnapshot) {
        button._adminStudioActionFeedbackSnapshot = {
            html: button.innerHTML,
            disabled: button.disabled,
            title: button.getAttribute('title'),
            ariaLabel: button.getAttribute('aria-label')
        };
    }

    return button._adminStudioActionFeedbackSnapshot;
}

function renderAdminStudioActionFeedbackContent(button, state, text, options = {}) {
    if (!isAdminStudioActionFeedbackButton(button)) {
        return;
    }

    const label = document.createElement('span');
    label.className = 'admin-action-feedback__label';
    label.textContent = text;

    if (options?.hideIcon === true && state !== 'loading') {
        button.replaceChildren(label);
        return;
    }

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    if (state === 'loading') {
        icon.className = 'admin-action-feedback__spinner';
    } else {
        icon.className = `admin-action-feedback__icon ${state === 'failed' ? 'is-failed' : 'is-saved'}`;
        icon.textContent = state === 'failed' ? '!' : '✓';
    }

    if (options?.compact === true) {
        const sr = document.createElement('span');
        sr.className = 'admin-action-feedback__sr';
        sr.textContent = text;
        button.replaceChildren(icon, sr);
        button.setAttribute('aria-label', text);
        return;
    }

    button.replaceChildren(icon, label);
}

function setAdminStudioActionButtonState(button, state = 'loading', options = {}) {
    if (!isAdminStudioActionFeedbackButton(button)) {
        return null;
    }

    clearAdminStudioActionFeedbackTimer(button);
    const normalizedState = ['loading', 'saved', 'failed'].includes(state) ? state : 'loading';
    const fallbackText = normalizedState === 'loading' ? '处理中...' : normalizedState === 'failed' ? '失败' : '已完成';
    const text = normalizeAdminStudioActionFeedbackText(
        options?.text || options?.loadingText || options?.successText || options?.errorText,
        fallbackText
    );

    ensureAdminStudioActionFeedbackSnapshot(button);
    button.classList.remove('is-loading', 'is-saved', 'is-failed');
    button.classList.add(`is-${normalizedState}`);
    button.dataset.actionFeedbackState = normalizedState;
    button.disabled = true;
    button.setAttribute('aria-busy', normalizedState === 'loading' ? 'true' : 'false');
    renderAdminStudioActionFeedbackContent(button, normalizedState, text, {
        hideIcon: options?.hideIcon === true,
        compact: options?.compact === true
    });

    return button;
}

function restoreAdminStudioActionButton(button) {
    if (!isAdminStudioActionFeedbackButton(button)) {
        return null;
    }

    clearAdminStudioActionFeedbackTimer(button);
    const snapshot = button._adminStudioActionFeedbackSnapshot || null;
    button.classList.remove('is-loading', 'is-saved', 'is-failed');
    button.removeAttribute('data-action-feedback-state');
    button.removeAttribute('aria-busy');

    if (snapshot) {
        button.innerHTML = snapshot.html;
        button.disabled = Boolean(snapshot.disabled);
        if (snapshot.title === null) {
            button.removeAttribute('title');
        } else {
            button.setAttribute('title', snapshot.title);
        }
        if (snapshot.ariaLabel === null) {
            button.removeAttribute('aria-label');
        } else {
            button.setAttribute('aria-label', snapshot.ariaLabel);
        }
        button._adminStudioActionFeedbackSnapshot = null;
    }

    return button;
}

function finishAdminStudioActionButton(button, options = {}) {
    const target = setAdminStudioActionButtonState(button, 'saved', {
        successText: options?.successText || options?.text || '已完成',
        hideIcon: options?.hideIcon === true,
        compact: options?.compact === true
    });
    const restoreDelayMs = Number.isFinite(Number(options?.restoreDelayMs)) ? Number(options.restoreDelayMs) : 900;
    if (target && restoreDelayMs >= 0) {
        target._adminStudioActionFeedbackRestoreTimer = window.setTimeout(() => {
            restoreAdminStudioActionButton(target);
        }, restoreDelayMs);
    }
    return target;
}

function failAdminStudioActionButton(button, options = {}) {
    const target = setAdminStudioActionButtonState(button, 'failed', {
        errorText: options?.errorText || options?.text || '失败',
        compact: options?.compact === true
    });
    const restoreDelayMs = Number.isFinite(Number(options?.restoreDelayMs)) ? Number(options.restoreDelayMs) : 1200;
    if (target && restoreDelayMs >= 0) {
        target._adminStudioActionFeedbackRestoreTimer = window.setTimeout(() => {
            restoreAdminStudioActionButton(target);
        }, restoreDelayMs);
    }
    return target;
}

window.AdminStudioActionFeedback = {
    setLoading(button, options = {}) {
        return setAdminStudioActionButtonState(button, 'loading', {
            loadingText: options?.loadingText || options?.text || '处理中...',
            compact: options?.compact === true
        });
    },
    finish: finishAdminStudioActionButton,
    fail: failAdminStudioActionButton,
    restore: restoreAdminStudioActionButton
};

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
    pendingUploadFileFingerprints.clear();
    analysisResult = null;
    currentEditingPromptAiTags = null;
    currentEditingPromptImageUrls = [];
    currentEditingPromptImageAssets = [];
    document.getElementById('previewGrid').innerHTML = '';
    setAdminStudioVisibility(document.getElementById('promptForm'), false);
    document.getElementById('promptForm').reset();
    resetPromptBilingualFields();
    resetPromptSourceFields();
    resetPromptOpsFields();
    document.getElementById('tagObjects').innerHTML = '';
    document.getElementById('tagScenes').innerHTML = '';
    document.getElementById('tagStyles').innerHTML = '';
    document.getElementById('tagMood').innerHTML = '';
    document.getElementById('tagUseCasePlatform').innerHTML = '';
    document.getElementById('tagUseCasePurpose').innerHTML = '';
    document.getElementById('tagUseCaseFormat').innerHTML = '';
    document.getElementById('tagCommercialNiche').innerHTML = '';
    document.getElementById('tagCommercialAudience').innerHTML = '';
    document.getElementById('tagDifficulty').innerHTML = '';
    document.getElementById('colorSwatches').innerHTML = '';

    // Hide last edited info
    const lastEditedInfo = document.getElementById('lastEditedInfo');
    setAdminStudioVisibility(lastEditedInfo, false);

    updateAnalyzeButton();
    syncGalleryEditModePanels('create');
    updateStatus('Ready', 'ready');
}

window.resetForm = resetForm;

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
    bindAdminStudioLightboxCloseButton();
    document.getElementById('lightboxOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'lightboxOverlay') closeLightbox();
    });

    // Crop modal
    document.getElementById('cropCancel')?.addEventListener('click', closeCropModal);
    document.getElementById('cropApply')?.addEventListener('click', applyCrop);

    // Global keyboard events for image preview
    document.addEventListener('keydown', handleImageKeydown);
}

function handleAdminStudioLightboxCloseActivation(event) {
    if (event.type === 'pointerup' && typeof event.button === 'number' && event.button !== 0) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeLightbox();
}

function bindAdminStudioLightboxCloseButton() {
    const button = document.getElementById('lightboxClose');
    if (!(button instanceof HTMLElement) || button.dataset.adminLightboxTouchBound === '1') {
        return;
    }

    button.dataset.adminLightboxTouchBound = '1';
    button.addEventListener('click', handleAdminStudioLightboxCloseActivation);
    button.addEventListener('pointerup', handleAdminStudioLightboxCloseActivation);
    button.addEventListener('touchend', handleAdminStudioLightboxCloseActivation, { passive: false });
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

async function completePromptBilingualFields(prompt = {}, writableSite = getAdminPromptsReadSite(), options = {}) {
    const promptId = String(prompt?.id || '').trim();
    if (!promptId) {
        throw new Error('缺少 Prompt ID，无法补全双语');
    }
    if (!window.PromptTranslator || !window.AdminAI?.configured) {
        throw new Error('请先配置可用的 AI 翻译服务');
    }

    const translationSource = buildPromptBilingualCompletionSource(prompt);
    const seededTranslationFields = typeof PromptTranslator.seedCoverageFields === 'function'
        ? PromptTranslator.seedCoverageFields(translationSource)
        : {};
    const completeTranslationSource = {
        ...translationSource,
        ...seededTranslationFields
    };
    const translationMode = String(options.mode || 'coverage').trim().toLowerCase() === 'full'
        ? 'full'
        : 'coverage';
    const translatedFields = await withTimeout(
        PromptTranslator.translatePromptFields(completeTranslationSource, { mode: translationMode }),
        Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 45000,
        options.timeoutMessage || `Prompt ${promptId} 补全双语超时，请稍后重试`
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
        return {
            row: prompt,
            payload,
            nextCoverage,
            unchanged: true,
            persistenceState: {
                row: prompt,
                missingFields: []
            }
        };
    }

    const response = await mutateAdminPrompt({
        action: 'patch',
        site: writableSite,
        id: promptId,
        payload
    });
    const persistenceState = await verifyPromptPersistedBilingualFields(promptId, payload, response?.row || {});
    if (persistenceState.missingFields.length > 0) {
        const warningMessage = buildPromptBilingualPersistenceWarningMessage(
            persistenceState.missingFields,
            persistenceState
        );
        const persistenceError = new Error(warningMessage || '双语结果暂未确认写入，请刷新后复查');
        persistenceError.persistenceState = persistenceState;
        persistenceError.missingFields = persistenceState.missingFields;
        throw persistenceError;
    }

    return {
        row: {
            ...prompt,
            ...payload,
            ...(persistenceState.row || response?.row || {}),
            id: promptId
        },
        payload,
        nextCoverage,
        unchanged: false,
        persistenceState
    };
}

function requireSelectedPromptsForBatch(label = '批量操作') {
    const selected = getSelectedPromptsData();
    if (selected.length > 0) {
        return selected;
    }

    showAdminStudioToast(`请先选择要执行「${label}」的 Prompt`, 'error');
    return null;
}

async function setPromptAdminStatus(prompt = {}, nextStatus = '', writableSite = getAdminPromptsReadSite()) {
    const promptId = String(prompt?.id || '').trim();
    if (!promptId) {
        throw new Error('缺少 Prompt ID，无法更新运营状态');
    }

    const normalizedStatus = String(nextStatus || '').trim().toLowerCase();
    const currentAiTags = clonePromptAiTags(prompt.ai_tags || prompt.aiTags || {});
    const currentOps = getPromptAdminOpsData(prompt);
    const nextAiTags = buildPromptAiTagsPayload(currentAiTags, {
        adminOps: {
            ...currentOps,
            status: normalizedStatus
        }
    });

    const response = await mutateAdminPrompt({
        action: 'patch',
        site: writableSite,
        id: promptId,
        payload: {
            ai_tags: nextAiTags || {}
        }
    });

    markHomepagePromptPoolUpdated();
    return response?.row || {
        ...prompt,
        ai_tags: nextAiTags || {},
        id: promptId
    };
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
        return setPromptAdminStatus(prompt, normalizedStatus, writableSite);
    });

    const results = await Promise.allSettled(tasks);
    const successCount = results.filter((item) => item.status === 'fulfilled').length;
    const failureCount = results.length - successCount;

    if (successCount > 0) {
        await loadAdminPrompts();
    }

    if (failureCount > 0) {
        showAdminStudioToast(`${statusLabel} 已更新 ${successCount} 条，失败 ${failureCount} 条`, successCount > 0 ? 'warning' : 'error');
        return false;
    }

    showAdminStudioToast(`${statusLabel} 已更新 ${successCount} 条 Prompt`, 'success');
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
        showAdminStudioToast(`批量加入首页失败: ${error.message || '未知错误'}`, 'error');
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

    const progressToast = showAdminStudioToast(`正在为 ${selected.length} 条 Prompt 补全双语...`, 'info', { durationMs: 0 });
    const finalizeProgressToast = (message, type = 'info', durationMs = 4200) => {
        if (progressToast && progressToast.isConnected) {
            setToastContent(progressToast, message, type);
            scheduleToastDismiss(progressToast, durationMs);
            return;
        }
        showAdminStudioToast(message, type, { durationMs });
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
            const completionResult = await completePromptBilingualFields(prompt, writableSite);
            if (completionResult.unchanged) {
                unchangedCount += 1;
                if (!completionResult.nextCoverage.zh || !completionResult.nextCoverage.en) {
                    incompleteCount += 1;
                }
                continue;
            }

            localizedRows.push(completionResult.row);
            localizedCount += 1;
            if (!completionResult.nextCoverage.zh || !completionResult.nextCoverage.en) {
                incompleteCount += 1;
            }
        } catch (error) {
            if (Array.isArray(error?.missingFields) && error.missingFields.length > 0) {
                persistenceBlockedCount += 1;
                if (!persistenceWarningDetail) {
                    persistenceWarningDetail = error.message || buildPromptBilingualPersistenceWarningMessage(error.missingFields);
                }
                console.warn('[Gallery] Batch bilingual completion did not persist bilingual fields:', prompt?.id, error.missingFields, error.persistenceState?.verificationError);
                continue;
            }
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
        showAdminStudioToast('请先选择要编辑的提示词', 'error');
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
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: '批量分析并补全双语 Prompt' });
    if (!writableSite) {
        return;
    }

    // Check API key first
    if (!window.AdminAI?.configured || !window.PromptTranslator) {
        showAdminStudioToast(
            !window.AdminAI?.configured
                ? getCurrentAIMissingConfigMessage()
                : '双语补全模块尚未加载，请刷新页面后重试',
            'error'
        );
        await checkApiKey();
        return;
    }

    const selected = getSelectedPromptsData();
    if (selected.length === 0) {
        showAdminStudioToast('请先选择要重分析的提示词', 'error');
        return;
    }

    // Show confirmation with API cost
    if (!confirm(`确定要完整处理 ${selected.length} 个提示词吗？\n\n系统会自动完成图片分析、标题与属性生成、双语补全，并在数据库中确认保存结果。`)) {
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
        showAdminStudioToast('所有提示词都已有 AI 标签', 'success');
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

    showBatchProgressModal('批量分析并补全双语', prompts.length);

    let success = 0;
    let analysisFailed = 0;
    let bilingualFailed = 0;
    let verificationFailed = 0;
    const failureMessages = [];
    const completedRows = [];

    for (let i = 0; i < prompts.length; i++) {
        if (batchCancelled) break;

        // Handle pause
        while (batchPaused && !batchCancelled) {
            await sleep(100);
        }
        if (batchCancelled) break;

        const prompt = prompts[i];
        const promptLabel = String(
            prompt?.title
            || prompt?.title_zh
            || prompt?.title_en
            || prompt?.id
            || '未命名 Prompt'
        ).trim();
        let currentStage = 'analysis';

        try {
            updateBatchProgress(i, prompts.length, promptLabel, {
                stage: '完整分析',
                itemIndex: i + 1
            });
            let savedPrompt = await runGalleryImportPipelineStageWithRetry({
                label: '完整分析',
                index: i + 1,
                total: prompts.length,
                maxAttempts: GALLERY_IMPORT_ANALYSIS_MAX_ATTEMPTS,
                reportStatus: (message) => {
                    updateBatchProgress(i + 0.2, prompts.length, promptLabel, {
                        stage: message,
                        itemIndex: i + 1
                    });
                },
                operation: async () => reanalyzeSinglePrompt(prompt, writableSite)
            });

            if (batchCancelled) break;

            currentStage = 'bilingual';
            updateBatchProgress(i + 0.5, prompts.length, savedPrompt.title || promptLabel, {
                stage: '补全双语',
                itemIndex: i + 1
            });
            const bilingualResult = await runGalleryImportPipelineStageWithRetry({
                label: '双语补全',
                index: i + 1,
                total: prompts.length,
                maxAttempts: GALLERY_IMPORT_BILINGUAL_MAX_ATTEMPTS,
                reportStatus: (message) => {
                    updateBatchProgress(i + 0.65, prompts.length, savedPrompt.title || promptLabel, {
                        stage: message,
                        itemIndex: i + 1
                    });
                },
                operation: async () => completePromptBilingualFields(savedPrompt, writableSite, {
                    mode: 'full'
                })
            });
            savedPrompt = bilingualResult.row || savedPrompt;

            currentStage = 'verification';
            updateBatchProgress(i + 0.9, prompts.length, savedPrompt.title || promptLabel, {
                stage: '确认保存结果',
                itemIndex: i + 1
            });
            const refreshed = await fetchAdminPromptItem(savedPrompt.id || prompt.id, {
                site: writableSite,
                hydrateBilingual: true
            });
            const verifiedPrompt = refreshed?.row;
            if (!verifiedPrompt) {
                throw new Error('处理完成后无法读取数据库记录');
            }

            const missingAnalysis = getGalleryImportMissingAnalysisLabels(verifiedPrompt);
            if (missingAnalysis.length > 0) {
                throw new Error(`完整分析未保存：${missingAnalysis.join('、')}`);
            }
            const missingBilingual = getGalleryImportMissingBilingualLabels(verifiedPrompt);
            if (missingBilingual.length > 0) {
                throw new Error(`双语字段未保存：${missingBilingual.join('、')}`);
            }

            completedRows.push(verifiedPrompt);
            success++;
            updateBatchProgress(i + 1, prompts.length, verifiedPrompt.title || promptLabel, {
                stage: '处理完成',
                itemIndex: i + 1
            });
        } catch (err) {
            if (currentStage === 'analysis') {
                analysisFailed += 1;
            } else if (currentStage === 'bilingual') {
                bilingualFailed += 1;
            } else {
                verificationFailed += 1;
            }
            failureMessages.push(normalizeBatchPromptFailureMessage(err, prompt));
            console.error(`Failed to fully process ${promptLabel} at ${currentStage}:`, err);
        }

        if (i < prompts.length - 1 && !batchCancelled) {
            await sleep(DELAY);
        }
    }

    hideBatchProgressModal();

    const failed = analysisFailed + bilingualFailed + verificationFailed;
    const failureBreakdown = [
        analysisFailed ? `分析失败 ${analysisFailed}` : '',
        bilingualFailed ? `双语失败 ${bilingualFailed}` : '',
        verificationFailed ? `保存确认失败 ${verificationFailed}` : ''
    ].filter(Boolean).join('，');
    const firstFailure = failureMessages[0] ? `；首条原因：${failureMessages[0]}` : '';

    if (batchCancelled) {
        showAdminStudioToast(
            `已取消。完整处理 ${success} 条${failureBreakdown ? `，${failureBreakdown}` : ''}${firstFailure}`,
            'warning',
            { durationMs: 7200 }
        );
    } else if (failed > 0) {
        showAdminStudioToast(
            `批量处理完成：完整成功 ${success} 条，${failureBreakdown}${firstFailure}`,
            success > 0 ? 'warning' : 'error',
            { durationMs: 8200 }
        );
    } else {
        showAdminStudioToast(`完整分析和双语补全已完成，共 ${success} 条`, 'success');
    }

    // Refresh grid
    await loadAdminPrompts();
    if (completedRows.length > 0) {
        hydrateAdminGalleryPromptsLocally(completedRows);
    }

    // Exit select mode
    if (isSelectMode) toggleSelectMode();

    return failed === 0 && !batchCancelled;
}

async function fetchImageBase64ViaAdmin(imageUrl = '') {
    const response = await (window.AdminApi?.fetch || fetch)('/api/admin?route=prompts/image-base64', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            image_url: imageUrl
        })
    });

    let payload = {};
    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }

    if (!response.ok || payload.success === false) {
        throw new Error(payload.message || `图片读取失败 (${response.status})`);
    }
    if (!payload.base64) {
        throw new Error('图片读取结果为空');
    }

    return {
        base64: payload.base64,
        mimeType: payload.mime_type || 'image/jpeg'
    };
}

async function getImageBase64ForAnalysis(imageUrl = '') {
    try {
        const response = await fetch(imageUrl, { mode: 'cors' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        return {
            base64: await blobToBase64(blob),
            mimeType: blob.type || 'image/jpeg'
        };
    } catch (error) {
        console.warn(`Browser image fetch failed, retrying through admin image reader: ${imageUrl}`, error);
        return fetchImageBase64ViaAdmin(imageUrl);
    }
}

function buildCompletePromptAnalysisResult(result = {}) {
    const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    return {
        ...source,
        objects: source.objects || { en: [], zh: [] },
        scenes: source.scenes || { en: [], zh: [] },
        styles: source.styles || { en: [], zh: [] },
        mood: source.mood || { en: [], zh: [] },
        useCase: source.useCase || {},
        commercial: source.commercial || {},
        difficulty: String(source.difficulty || '').trim(),
        dominantColors: normalizeAdminPromptTagList(source.dominantColors || [])
    };
}

function buildPromptFullAnalysisPayload(prompt = {}, result = {}) {
    const normalizedResult = buildCompletePromptAnalysisResult(result);
    const promptText = String(
        prompt.prompt_text
        || prompt.prompt
        || prompt.prompt_text_en
        || prompt.prompt_text_zh
        || ''
    ).trim();
    const primaryFields = resolvePromptPrimaryFields({
        prompt: promptText
    }, {
        ...normalizedResult,
        prompt_text: promptText
    });
    const currentOps = getPromptAdminOpsData(prompt);
    const currentAiTags = clonePromptAiTags(prompt.ai_tags || prompt.aiTags || {});
    const title = String(primaryFields.title || '').trim();
    const category = String(primaryFields.category || '').trim();
    const description = String(
        primaryFields.description
        || prompt.description
        || prompt.description_en
        || prompt.description_zh
        || ''
    ).trim();
    const payload = {
        title,
        tags: category ? [category] : [],
        description,
        ai_tags: buildPromptAiTagsPayload(currentAiTags, {
            analysisResult: normalizedResult,
            adminOps: currentOps
        }) || {},
        dominant_colors: normalizedResult.dominantColors
    };

    const bilingualFields = {
        title_en: normalizedResult.title_en || normalizedResult.title || title,
        title_zh: normalizedResult.title_zh || prompt.title_zh || '',
        description_en: normalizedResult.description_en || normalizedResult.description || description,
        description_zh: normalizedResult.description_zh || prompt.description_zh || ''
    };
    Object.entries(bilingualFields).forEach(([field, value]) => {
        const normalizedValue = String(value || '').trim();
        if (normalizedValue) {
            payload[field] = normalizedValue;
        }
    });

    return payload;
}

async function preparePromptImagesForFullAnalysis(prompt = {}, maxImages = 6) {
    const imageUrls = dedupePromptImageUrls([
        ...(Array.isArray(prompt.images) ? prompt.images : []),
        ...getPromptImageUrlsFromAssets(prompt.image_assets || prompt.imageAssets || [])
    ]).slice(0, Math.max(1, Number(maxImages) || 6));
    if (!imageUrls.length) {
        throw new Error('No images');
    }

    const results = await Promise.allSettled(imageUrls.map(async (imageUrl) => {
        const imageData = await getImageBase64ForAnalysis(imageUrl);
        const mimeType = imageData.mimeType || 'image/jpeg';
        return {
            file: null,
            url: imageUrl,
            base64: imageData.base64,
            mimeType,
            dataUrl: `data:${mimeType};base64,${imageData.base64}`
        };
    }));
    const preparedImages = results
        .filter((entry) => entry.status === 'fulfilled')
        .map((entry) => entry.value);
    if (!preparedImages.length) {
        const firstFailure = results.find((entry) => entry.status === 'rejected');
        throw new Error(`Image fetch failed: ${firstFailure?.reason?.message || '无法读取作品图片'}`);
    }
    results
        .filter((entry) => entry.status === 'rejected')
        .forEach((entry) => console.warn('[Gallery] Skipped an unreadable analysis image:', entry.reason));

    return preparedImages;
}

async function reanalyzeSinglePrompt(prompt, writableSite) {
    const promptId = String(prompt?.id || '').trim();
    if (!promptId) {
        throw new Error('缺少 Prompt ID，无法分析');
    }

    const preparedImages = await preparePromptImagesForFullAnalysis(prompt, 6);
    const gridImage = await createImageGrid(preparedImages);
    if (!gridImage?.base64) {
        throw new Error('无法生成图片分析预览');
    }
    console.log(`🖼️ Analyzing ${preparedImages.length} image(s) for Prompt ${promptId}`);

    console.log(`🤖 Calling ${getCurrentAIServiceLabel()}...`);
    const result = await callAdminVision(gridImage.base64, gridImage.mimeType || 'image/webp');
    console.log(`✅ ${getCurrentAIServiceLabel()} response received:`, result);

    const updateData = buildPromptFullAnalysisPayload(prompt, result);
    console.log('💾 Updating Supabase with complete analysis:', updateData);
    const response = await mutateAdminPrompt({
        action: 'patch',
        site: writableSite,
        id: promptId,
        payload: updateData
    });
    const refreshed = await fetchAdminPromptItem(promptId, {
        site: writableSite,
        hydrateBilingual: true
    });
    const savedPrompt = refreshed?.row || response?.row;
    if (!savedPrompt) {
        throw new Error('分析结果保存后无法读取');
    }
    const missingAnalysis = typeof getGalleryImportMissingAnalysisLabels === 'function'
        ? getGalleryImportMissingAnalysisLabels(savedPrompt)
        : [];
    if (missingAnalysis.length > 0) {
        throw new Error(`分析结果未完整保存：${missingAnalysis.join('、')}`);
    }

    markHomepagePromptPoolUpdated();
    console.log(`✅ Prompt ${promptId} reanalyzed successfully`);
    return savedPrompt;
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

        showAdminStudioToast(`成功删除 ${ids.length} 个提示词`, 'success');
        await loadAdminPrompts();

        // Exit select mode
        selectedPrompts.clear();
        if (isSelectMode) toggleSelectMode();

    } catch (err) {
        console.error('Batch delete error:', err);
        showAdminStudioToast('删除失败: ' + err.message, 'error');
    }
}

// ========================================
// PROGRESS MODAL
// ========================================
function showBatchProgressModal(title, total) {
    document.getElementById('batchModalTitle').textContent = title;
    showAdminStudioOverlay(document.getElementById('batchProgressOverlay'));
    updateBatchProgress(0, total, '准备中...', {
        stage: '准备任务',
        itemIndex: 0
    });
}

function hideBatchProgressModal() {
    hideAdminStudioOverlay(document.getElementById('batchProgressOverlay'));
}

function updateBatchProgress(current, total, currentItem, options = {}) {
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCurrent = Math.max(0, Math.min(Number(current) || 0, safeTotal || 0));
    const percent = safeTotal > 0 ? Math.round((safeCurrent / safeTotal) * 100) : 0;
    const stage = String(options.stage || '处理中').trim();
    const itemIndex = Math.max(0, Math.min(
        Number(options.itemIndex ?? Math.ceil(safeCurrent)) || 0,
        safeTotal
    ));
    document.getElementById('batchCurrentItem').textContent = `${stage}：${currentItem}`;
    document.getElementById('batchProgressFill').value = percent;
    document.getElementById('batchProgressText').textContent = `第 ${itemIndex}/${safeTotal} 条 · 总进度 ${percent}%`;

    // Estimate remaining time
    if (safeCurrent > 0 && batchStartTime) {
        const elapsed = Date.now() - batchStartTime;
        const perItem = elapsed / safeCurrent;
        const remaining = perItem * (safeTotal - safeCurrent);
        const remainingSec = Math.round(remaining / 1000);
        document.getElementById('batchTimeRemaining').textContent =
            `预计剩余: 约 ${remainingSec} 秒`;
    } else {
        document.getElementById('batchTimeRemaining').textContent = '预计剩余: --';
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
// GALLERY IMPORT ASSISTANT
// ========================================
const galleryImportState = {
    mode: 'crawl_only',
    batch: null,
    batches: [],
    selectedBatchId: '',
    batchSelectionLocked: false,
    localPreviewLocked: false,
    items: [],
    running: false,
    uploadInFlight: false,
    statusRefreshInFlight: false,
    autoDetectionEnabled: false,
    autoDetectionInFlight: false,
    autoDetectionTimer: 0,
    emptyMessage: '暂无导入内容'
};

const GALLERY_IMPORT_SOURCE_URL = 'https://www.meigen.ai';
const GALLERY_IMPORT_COLLECTOR_SCRIPT_PATH = '/integrations/meigen-gallery-collector/meigen-gallery-collector.user.js';
const GALLERY_IMPORT_COLLECTOR_VERSION = '2026-07-12.70';
const GALLERY_IMPORT_PIPELINE_VERSION = '20260710_GALLERY_FULL_ANALYSIS_BILINGUAL_2';
const GALLERY_IMPORT_MAX_PARALLELISM = 10;
const GALLERY_IMPORT_DEFAULT_PARALLELISM = 8;
const GALLERY_IMPORT_PARALLELISM_STORAGE_KEY = 'fatherKey.galleryImport.parallelism';
const GALLERY_IMPORT_STAGE_GAP_MS = 1500;
const GALLERY_IMPORT_ADAPTIVE_INITIAL_PARALLELISM = 8;
const GALLERY_IMPORT_ADAPTIVE_MIN_PARALLELISM = 1;
const GALLERY_IMPORT_ADAPTIVE_LAUNCH_GAP_MS = 500;
const GALLERY_IMPORT_ADAPTIVE_COOLDOWN_MS = 6000;
const GALLERY_IMPORT_RETRY_BASE_DELAY_MS = 1800;
const GALLERY_IMPORT_ANALYSIS_MAX_ATTEMPTS = 2;
const GALLERY_IMPORT_BILINGUAL_MAX_ATTEMPTS = 3;
const GALLERY_IMPORT_AUTO_DETECT_INTERVAL_MS = 5000;
const GALLERY_IMPORT_AUTO_DETECT_STORAGE_KEY = 'fatherKey.galleryImport.autoDetectQueue';
const GALLERY_IMPORT_AUTO_DETECT_LOCK_NAME = 'father-key-gallery-import-auto-upload';
const GALLERY_IMPORT_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function escapeGalleryImportHtml(value = '') {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const GALLERY_IMPORT_FAILURE_STAGES = Object.freeze({
    upload: {
        label: '图片上传',
        action: '请检查图片链接是否还能访问，然后重新上传'
    },
    lookup: {
        label: '作品读取',
        action: '作品引用已经失效或站点不一致；请在 Manage 确认作品是否存在，再决定清理或重新采集'
    },
    analysis: {
        label: '图片分析',
        action: '作品已经保存，再次点击“上传队列”会从图片分析继续'
    },
    bilingual: {
        label: '双语补全',
        action: '作品已经保存，再次点击“上传队列”会从双语补全继续'
    },
    publish: {
        label: '发布',
        action: '作品已经保存，再次点击“上传队列”会继续发布'
    },
    cleanup: {
        label: '暂存清理',
        action: '作品已经发布，再次点击“上传队列”会继续清理暂存'
    },
    ai: {
        label: 'AI 处理',
        action: '作品已经保存，请稍后重新执行分析、双语补全和发布'
    },
    unknown: {
        label: '后续处理',
        action: '请刷新队列后重试；仍失败时查看浏览器控制台日志'
    }
});

function normalizeGalleryImportFailureMessage(errorOrMessage = '', fallback = '处理失败') {
    const error = errorOrMessage instanceof Error ? errorOrMessage : null;
    const status = Number(error?.status || error?.statusCode || 0);
    const raw = String(error?.message || errorOrMessage || fallback).trim();

    if (status === 401 || status === 403 || /unauthorized|forbidden|not authenticated|登录.*失效/i.test(raw)) {
        return '后台登录状态或操作权限已失效，请刷新页面并重新登录';
    }
    if (/insufficient[_\s-]*(quota|balance|credits?)|quota exceeded|额度不足|余额不足/i.test(raw)) {
        return 'Codex Relay 上游账号额度不足，请检查账号额度后重试';
    }
    if (status === 429 || /rate limit|resource exhausted|请求过多|no available accounts|暂无可用账号/i.test(raw)) {
        return 'Codex Relay 当前上游账号被限流或暂无可用账号，系统将延迟重试';
    }
    if ([502, 503, 504, 522, 524].includes(status) || /bad gateway|service unavailable|gateway timeout|timed out|timeout|\b52[24]\b/i.test(raw)) {
        return 'Codex Relay 上游网关暂时不可用，系统将延迟重试';
    }
    if (/<!doctype\s+html|<html[\s>]|<!--\[if\s+lt\s+ie/i.test(raw)) {
        return '服务返回了异常网页而不是处理结果，通常是临时网关或登录状态问题';
    }
    if (/failed to parse ai response|unexpected token.*json|json parse/i.test(raw)) {
        return 'AI 返回格式不完整，请稍后重新分析';
    }
    if (/no response from ai/i.test(raw)) {
        return 'AI 服务没有返回结果，请稍后重试';
    }
    if (/ai translation could not establish coverage|ai translation returned empty fields/i.test(raw)) {
        return 'AI 翻译结果暂时不完整，请稍后重试';
    }
    if (/image decode failed|bitstream not supported|bad seek/i.test(raw)) {
        return '已保存图片格式无法解析，原图回退也未成功';
    }
    if (/image request failed/i.test(raw)) {
        return '图片网络读取失败，系统将自动重试临时故障';
    }
    if (/image fetch failed|图片读取失败|没有可保存的图片|no images/i.test(raw)) {
        return '图片读取失败，请检查原图链接是否还能访问';
    }
    if (/api key not valid|invalid api key|incorrect api key|authentication failed/i.test(raw)) {
        return '当前 AI 服务密钥无效或已失效，请在后台更新密钥后重试';
    }
    if (/请先配置可用的 ai 翻译服务|not configured|api key/i.test(raw)) {
        return 'AI 服务尚未正确配置，请先检查后台 AI 设置';
    }

    const text = raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return fallback;
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function createGalleryImportStageError(stage = 'unknown', error = null) {
    const normalizedStage = GALLERY_IMPORT_FAILURE_STAGES[stage] ? stage : 'unknown';
    const stageMeta = GALLERY_IMPORT_FAILURE_STAGES[normalizedStage];
    const reason = normalizeGalleryImportFailureMessage(error, '处理失败');
    const wrapped = new Error(`${stageMeta.label}失败：${reason}`);
    wrapped.galleryImportStage = normalizedStage;
    wrapped.originalError = error;
    return wrapped;
}

function getGalleryImportRootError(error = null) {
    let current = error;
    const visited = new Set();
    while (current?.originalError && !visited.has(current)) {
        visited.add(current);
        current = current.originalError;
    }
    return current || error;
}

function isGalleryImportPipelineRetryableError(error = null) {
    const rootError = getGalleryImportRootError(error);
    const status = Number(rootError?.status || rootError?.statusCode || error?.status || error?.statusCode || 0);
    const message = String(rootError?.message || error?.message || '').trim().toLowerCase();
    return GALLERY_IMPORT_RETRYABLE_STATUS_CODES.has(status)
        || message.includes('bad gateway')
        || message.includes('gateway timeout')
        || message.includes('service unavailable')
        || message.includes('resource exhausted')
        || message.includes('rate limit')
        || message.includes('quota')
        || message.includes('timeout')
        || message.includes('timed out')
        || message.includes('fetch failed')
        || message.includes('failed to fetch')
        || message.includes('network')
        || message.includes('no response from ai')
        || message.includes('failed to parse ai response')
        || message.includes('translation could not establish coverage')
        || message.includes('translation returned empty fields')
        || message.includes('双语结果未完整保存')
        || message.includes('分析结果不完整')
        || message.includes('分析结果未完整保存')
        || message.includes('analysis result incomplete')
        || message.includes('image fetch failed');
}

async function runGalleryImportPipelineStageWithRetry({
    label = 'AI 处理',
    operation,
    index = 0,
    total = 0,
    maxAttempts = 2,
    reportStatus = setGalleryImportRunStatus,
    onRetryableError = null
} = {}) {
    const safeAttempts = Math.max(1, Number(maxAttempts || 1));
    const progress = total ? `${index} / ${total}` : '';
    let lastError = null;

    for (let attempt = 1; attempt <= safeAttempts; attempt += 1) {
        reportStatus(
            `${label}${attempt > 1 ? `重试 ${attempt} / ${safeAttempts}` : '中'} ${progress}`.trim()
        );
        try {
            return await operation({ attempt, maxAttempts: safeAttempts });
        } catch (error) {
            lastError = error;
            const canRetry = attempt < safeAttempts && isGalleryImportPipelineRetryableError(error);
            if (!canRetry) {
                throw error;
            }
            if (typeof onRetryableError === 'function') {
                onRetryableError(error);
            }
            const delayMs = GALLERY_IMPORT_RETRY_BASE_DELAY_MS * attempt;
            reportStatus(
                `${label}暂时失败，${Math.ceil(delayMs / 1000)} 秒后自动重试 ${progress}`.trim()
            );
            await sleep(delayMs);
        }
    }

    throw lastError || new Error(`${label}失败`);
}

function getGalleryImportFailureInfo(item = {}) {
    if (String(item?.status || '').trim() !== 'failed') return null;
    const raw = String(item?.error_summary || item?.errorSummary || '').trim();
    if (!raw) return null;

    const stageEntries = [
        ['upload', /^(?:图片上传|上传)(失败|未完成)[:：]\s*/i],
        ['lookup', /^(?:作品读取|读取作品)(失败|未完成)[:：]\s*/i],
        ['analysis', /^(?:图片分析|分析)(失败|未完成)[:：]\s*/i],
        ['bilingual', /^(?:双语补全|补全双语)(失败|未完成)[:：]\s*/i],
        ['publish', /^发布(失败|未完成)[:：]\s*/i],
        ['cleanup', /^(?:暂存清理|清理)(失败|未完成)[:：]\s*/i]
    ];
    let stage = '';
    let reason = raw;
    let pending = false;
    for (const [candidateStage, pattern] of stageEntries) {
        const match = raw.match(pattern);
        if (!match) continue;
        stage = candidateStage;
        pending = match[1] === '未完成';
        reason = raw.replace(pattern, '');
        break;
    }
    if (!stage && /<!doctype\s+html|<html[\s>]|<!--\[if\s+lt\s+ie/i.test(raw)) {
        stage = 'ai';
    }
    if (!stage && String(item?.status || '') === 'failed') {
        stage = 'unknown';
    }
    const stageMeta = GALLERY_IMPORT_FAILURE_STAGES[stage || 'unknown'];
    return {
        stage: stage || 'unknown',
        label: pending ? `待${stageMeta.label}` : `${stageMeta.label}失败`,
        message: normalizeGalleryImportFailureMessage(reason, '处理失败'),
        action: stageMeta.action
    };
}

function normalizeGalleryImportNumber(value, fallback = 0, maxValue = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, maxValue);
}

function getGalleryImportSettings() {
    return {
        favorite_min: normalizeGalleryImportNumber(document.getElementById('galleryImportFavoriteMin')?.value, 0, 1000000),
        favorite_max: normalizeGalleryImportNumber(document.getElementById('galleryImportFavoriteMax')?.value, 0, 1000000),
        max_items: normalizeGalleryImportNumber(document.getElementById('galleryImportMaxItems')?.value, 50, 1000) || 50,
        max_images_per_item: normalizeGalleryImportNumber(document.getElementById('galleryImportMaxImages')?.value, 12, 24) || 12,
        parallelism: normalizeGalleryImportNumber(
            document.getElementById('galleryImportParallelism')?.value,
            GALLERY_IMPORT_DEFAULT_PARALLELISM,
            GALLERY_IMPORT_MAX_PARALLELISM
        ) || GALLERY_IMPORT_DEFAULT_PARALLELISM,
        default_status: 'review',
        duplicate_policy: 'skip',
        auto_cleanup: true,
        analyze_after_save: true
    };
}

function setGalleryImportMode(mode = 'crawl_only') {
    const normalizedMode = ['stream', 'crawl_only', 'upload_only'].includes(mode) ? mode : 'crawl_only';
    galleryImportState.mode = normalizedMode;
    document.querySelectorAll('[data-admin-action="gallery-import-set-mode"]').forEach((button) => {
        const active = button.dataset.importMode === normalizedMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    setGalleryImportRunStatus(
        normalizedMode === 'stream'
            ? '边抓边上传'
            : (normalizedMode === 'upload_only' ? '仅上传队列' : '仅抓取预览')
    );
}

function setGalleryImportRunStatus(text = '') {
    const statusEl = document.getElementById('galleryImportRunStatus');
    if (statusEl) {
        statusEl.textContent = text || '等待开始';
    }
}

function setGalleryImportEmptyMessage(message = '') {
    galleryImportState.emptyMessage = message || '暂无导入内容';
}

function buildGalleryImportCollectorBookmarklet() {
    const scriptUrl = new URL(GALLERY_IMPORT_COLLECTOR_SCRIPT_PATH, window.location.origin);
    scriptUrl.searchParams.set('v', GALLERY_IMPORT_COLLECTOR_VERSION);
    const code = [
        '(()=>{',
        'const s=document.createElement("script");',
        `s.src=${JSON.stringify(scriptUrl.toString())};`,
        's.async=true;',
        's.dataset.fatherKeyMeigenCollector="1";',
        '(document.documentElement||document.body).appendChild(s);',
        '})()'
    ].join('');
    return `javascript:${code}`;
}

async function copyGalleryImportText(text = '') {
    const value = String(text || '');
    if (!value) return false;
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (_) {
        // Fall back to a temporary textarea below.
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch (_) {
        copied = false;
    }
    textarea.remove();
    return copied;
}

async function copyGalleryImportCollector() {
    const copied = await copyGalleryImportText(buildGalleryImportCollectorBookmarklet());
    if (copied) {
        setGalleryImportRunStatus('采集器已复制');
        showAdminStudioToast('采集器已复制，可保存到浏览器书签后在 Meigen 页面运行', 'success');
    } else {
        setGalleryImportRunStatus('采集器复制失败');
        showAdminStudioToast('采集器复制失败，请稍后重试', 'error');
    }
}

function buildGalleryImportApiUrl(params = {}) {
    const url = new URL('/api/admin/prompts/imports', window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });
    return `${url.pathname}${url.search}`;
}

async function fetchGalleryImportApi(params = {}, options = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildGalleryImportApiUrl(params), {
        credentials: 'include',
        ...options,
        headers: {
            ...(options.headers || {})
        }
    });

    let payload = {};
    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }

    if (!response.ok) {
        const error = new Error(payload?.message || `导入请求失败 (${response.status})`);
        error.payload = payload;
        error.status = response.status;
        throw error;
    }

    return payload;
}

async function mutateGalleryImport(action, payload = {}) {
    return fetchGalleryImportApi({}, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action,
            ...payload
        })
    });
}

function normalizeGalleryImportRawItem(item = {}) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const promptText = String(item.prompt_text || item.promptText || item.prompt || '').trim();
    const originalWorkUrl = String(item.original_work_url || item.originalWorkUrl || item.source_url || item.sourceUrl || '').trim();
    const authorHandle = getGalleryImportAuthorHandle(item, originalWorkUrl);
    const imageSource = item.image_sources || item.imageSources || item.images || item.image_urls || item.imageUrls || [];
    const imageCount = Array.isArray(imageSource)
        ? imageSource.length
        : String(imageSource || '').split(/[\n\r,，]+/).filter(Boolean).length;
    const expectedImageCount = Math.max(
        imageCount,
        Number(item.expected_image_count || item.expectedImageCount || item.image_count || item.imageCount || 0) || 0
    );
    return {
        ...item,
        prompt_text: promptText,
        original_work_url: originalWorkUrl,
        author_handle: authorHandle,
        image_sources: imageSource,
        __imageCount: expectedImageCount
    };
}

function getGalleryImportAuthorHandle(item = {}, originalWorkUrl = '') {
    const explicit = String(item?.author_handle || item?.authorHandle || item?.author_id || item?.authorId || item?.handle || '').trim();
    if (explicit) return explicit.startsWith('@') ? explicit : `@${explicit}`;
    try {
        const parsed = new URL(String(originalWorkUrl || ''));
        if (!/(^|\.)(?:x|twitter)\.com$/i.test(parsed.hostname)) return '';
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length < 3 || String(parts[1]).toLowerCase() !== 'status') return '';
        if (!parts[0] || ['i', 'intent', 'share'].includes(String(parts[0]).toLowerCase())) return '';
        return `@${String(parts[0]).replace(/^@/, '')}`;
    } catch (_) {
        return '';
    }
}

function parseGalleryImportRawInput(rawText = '') {
    const raw = String(rawText || '').trim();
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed.prompts) ? parsed.prompts : []));
        return items.map(normalizeGalleryImportRawItem).filter(Boolean);
    } catch (_) {
        const rows = raw
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
        return rows.map(normalizeGalleryImportRawItem).filter(Boolean);
    }
}

function getGalleryImportItemsFromInput() {
    const rawInput = document.getElementById('galleryImportRawInput');
    return parseGalleryImportRawInput(rawInput?.value || '');
}

function getGalleryImportImageSources(item = {}) {
    const source = item.image_sources || item.imageSources || item.images || [];
    if (!Array.isArray(source)) return [];
    return source.map((entry) => {
        if (typeof entry === 'string') return entry;
        return entry?.url || entry?.original || entry?.src || entry?.downloadUrl || entry?.download_url || '';
    }).filter(Boolean);
}

function getGalleryImportAssetUrls(item = {}, fieldName = 'final_image_assets') {
    const source = item?.[fieldName] || [];
    if (!Array.isArray(source)) return [];
    return source.map((entry) => {
        if (typeof entry === 'string') return entry;
        return entry?.original || entry?.url || entry?.src || entry?.publicUrl || entry?.public_url || '';
    }).filter(Boolean);
}

function getGalleryImportExpectedImageCount(item = {}) {
    const details = item?.error_details || item?.errorDetails || {};
    const candidates = [
        item.expected_image_count,
        item.expectedImageCount,
        item.image_count,
        item.imageCount,
        details.import_image_count,
        details.expected_image_count,
        details.source_image_count,
        item.__imageCount
    ].map((value) => Number(value || 0)).filter((value) => Number.isFinite(value) && value > 0);
    return candidates.length ? Math.max(...candidates) : 0;
}

function getGalleryImportDisplayImageCount(item = {}) {
    return Math.max(
        getGalleryImportAssetUrls(item, 'final_image_assets').length,
        getGalleryImportImageSources(item).length,
        getGalleryImportAssetUrls(item, 'temp_image_assets').length,
        getGalleryImportExpectedImageCount(item)
    );
}

function getGalleryImportCoverUrl(item = {}) {
    return getGalleryImportImageSources(item)[0]
        || getGalleryImportAssetUrls(item, 'final_image_assets')[0]
        || getGalleryImportAssetUrls(item, 'temp_image_assets')[0]
        || '';
}

function getGalleryImportStatusLabel(status = '') {
    const labels = {
        staged: '已抓取',
        needs_review: '需要处理',
        duplicate: '疑似重复',
        queued: '等待上传',
        uploading: '保存图片中',
        saving: '写入 Gallery',
        imported: '已保存',
        failed: '失败',
        skipped: '已跳过',
        cleaned: '已清理'
    };
    return labels[String(status || '').trim()] || '等待处理';
}

function getGalleryImportPipelineStageLabel(stage = '') {
    const labels = {
        claimed: 'Worker 已领取',
        analysis: 'AI 图片分析',
        completed: '处理完成',
        staged: '等待 Worker'
    };
    return labels[String(stage || '').trim()] || String(stage || '').trim();
}

function getGalleryImportBatchStats(batch = {}) {
    const stats = batch?.stats && typeof batch.stats === 'object' ? batch.stats : {};
    const number = (key) => Math.max(0, Number(stats[key] || 0));
    const total = Math.max(0, Number(stats.total || 0));
    const pending = number('staged') + number('queued') + number('uploading') + number('saving');
    const completed = number('cleaned') + number('imported');
    const attention = number('failed') + number('needs_review');
    return {
        total,
        attempted: Math.max(total, number('attempted')),
        accepted: Math.max(total, number('accepted')),
        skippedDuplicates: number('skipped_duplicates'),
        rejected: number('rejected'),
        pending,
        completed,
        attention,
        failed: number('failed'),
        needsReview: number('needs_review'),
        duplicates: number('duplicate'),
        skipped: number('skipped')
    };
}

function getGalleryImportBatchStatusLabel(batch = {}) {
    const stats = getGalleryImportBatchStats(batch);
    if (!stats.total && stats.attempted > 0 && stats.skippedDuplicates >= stats.attempted) return '全部重复';
    if (!stats.total && stats.rejected > 0) return '未接收';
    if (!stats.total) return '空批次';
    if (stats.pending) return '处理中';
    if (stats.attention) return '需要处理';
    if (String(batch?.status || '') === 'completed') return '已完成';
    return '等待处理';
}

function formatGalleryImportBatchTime(value = '') {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function selectGalleryImportBatch(batches = [], options = {}) {
    const rows = Array.isArray(batches) ? batches : [];
    const preferredId = String(options.preferredBatchId || '').trim();
    const pendingBatch = rows.find((batch) => getGalleryImportBatchStats(batch).pending > 0);
    const preferred = rows.find((batch) => String(batch?.id || '') === preferredId);
    if (preferred) return preferred;
    if (options.preferPending && pendingBatch) return pendingBatch;
    const current = rows.find((batch) => (
        String(batch?.id || '') === String(galleryImportState.selectedBatchId || '')
        && getGalleryImportBatchStats(batch).total > 0
    ));
    if (current) return current;
    if (pendingBatch) return pendingBatch;
    return rows.find((batch) => getGalleryImportBatchStats(batch).total > 0) || rows[0] || null;
}

function renderGalleryImportBatchTracker() {
    const select = document.getElementById('galleryImportBatchSelect');
    const summary = document.getElementById('galleryImportBatchSummary');
    const batches = Array.isArray(galleryImportState.batches) ? galleryImportState.batches : [];
    if (select) {
        select.innerHTML = batches.length
            ? batches.map((batch) => {
                const stats = getGalleryImportBatchStats(batch);
                const selected = String(batch.id || '') === String(galleryImportState.selectedBatchId || '');
                const label = `${String(batch.id || '').slice(0, 8)} · ${getGalleryImportBatchStatusLabel(batch)} · ${stats.total} 条 · ${formatGalleryImportBatchTime(batch.updated_at)}`;
                return `<option value="${escapeGalleryImportHtml(batch.id || '')}"${selected ? ' selected' : ''}>${escapeGalleryImportHtml(label)}</option>`;
            }).join('')
            : '<option value="">暂无批次</option>';
    }
    if (!summary) return;
    const batch = galleryImportState.batch;
    if (!batch) {
        summary.innerHTML = '<span>尚未加载服务端批次</span>';
        return;
    }
    const stats = getGalleryImportBatchStats(batch);
    summary.innerHTML = [
        `<span>批次 ${escapeGalleryImportHtml(batch.id || '')}</span>`,
        `<span>${escapeGalleryImportHtml(getGalleryImportBatchStatusLabel(batch))}</span>`,
        `<span>尝试 ${stats.attempted}</span>`,
        `<span>实际入队 ${stats.accepted}</span>`,
        `<span>仓库重复 ${stats.skippedDuplicates}</span>`,
        `<span>未接收 ${stats.rejected}</span>`,
        `<span>总数 ${stats.total}</span>`,
        `<span>待处理 ${stats.pending}</span>`,
        `<span>已完成 ${stats.completed}</span>`,
        `<span>失败 ${stats.failed}</span>`,
        `<span>需复核 ${stats.needsReview}</span>`,
        `<span>批次内跳过 ${stats.duplicates + stats.skipped}</span>`,
        `<span>更新 ${escapeGalleryImportHtml(formatGalleryImportBatchTime(batch.updated_at))}</span>`
    ].join('');
}

function getGalleryImportStats(items = galleryImportState.items) {
    const rows = Array.isArray(items) ? items : [];
    const counts = rows.reduce((acc, item) => {
        const status = String(item?.status || 'staged').trim() || 'staged';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});
    const uploadRelevant = rows.filter((item) => (
        ['staged', 'queued', 'uploading', 'saving', 'imported', 'cleaned', 'failed'].includes(String(item?.status || ''))
    ));
    const uploadable = rows.filter((item) => isGalleryImportItemUploadable(item));
    const uploadFinished = uploadRelevant.filter((item) => ['imported', 'cleaned', 'failed'].includes(String(item?.status || ''))).length;
    const crawlFinished = rows.length;
    const totalFinished = rows.filter((item) => (
        ['imported', 'cleaned', 'failed', 'needs_review', 'duplicate', 'skipped'].includes(String(item?.status || ''))
    )).length;
    const failureStages = rows.reduce((acc, item) => {
        if (String(item?.status || '') !== 'failed') return acc;
        const info = getGalleryImportFailureInfo(item);
        const stage = info?.stage || 'unknown';
        acc[stage] = (acc[stage] || 0) + 1;
        return acc;
    }, {});
    return {
        total: rows.length,
        imported: counts.imported || 0,
        cleaned: counts.cleaned || 0,
        failed: counts.failed || 0,
        needs_review: counts.needs_review || 0,
        duplicate: counts.duplicate || 0,
        uploadable: uploadable.length,
        uploadTotal: uploadRelevant.length,
        uploadFinished,
        crawlFinished,
        totalFinished,
        failureStages
    };
}

function updateGalleryImportProgress() {
    const stats = getGalleryImportStats();
    const setProgress = (progressId, textId, current, total) => {
        const progress = document.getElementById(progressId);
        const text = document.getElementById(textId);
        const safeTotal = Math.max(0, Number(total) || 0);
        const safeCurrent = Math.min(Math.max(0, Number(current) || 0), safeTotal || Number(current) || 0);
        const percent = safeTotal ? Math.round((safeCurrent / safeTotal) * 100) : 0;
        if (progress) progress.value = percent;
        if (text) text.textContent = `${safeCurrent} / ${safeTotal}`;
    };

    setProgress('galleryImportCrawlProgress', 'galleryImportCrawlText', stats.crawlFinished, stats.total);
    setProgress('galleryImportUploadProgress', 'galleryImportUploadText', stats.uploadFinished, stats.uploadTotal);
    setProgress('galleryImportTotalProgress', 'galleryImportTotalText', stats.totalFinished, stats.total);

    const summary = document.getElementById('galleryImportSummary');
    if (summary) {
        const failureLabels = Object.entries(stats.failureStages || {})
            .filter(([, count]) => Number(count) > 0)
            .map(([stage, count]) => {
                const label = GALLERY_IMPORT_FAILURE_STAGES[stage]?.label || '后续处理';
                return `<span class="is-warning">${escapeGalleryImportHtml(label)}失败 ${Number(count)} 条</span>`;
            });
        summary.innerHTML = [
            `<span>发现 ${stats.total} 条</span>`,
            `<span>成功 ${stats.imported + stats.cleaned} 条</span>`,
            `<span>需要处理 ${stats.failed + stats.needs_review} 条</span>`,
            `<span>跳过重复 ${stats.duplicate} 条</span>`,
            ...failureLabels
        ].join('');
    }
}

function renderGalleryImportQueue(items = galleryImportState.items) {
    const queue = document.getElementById('galleryImportQueue');
    if (!queue) return;

    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
        queue.innerHTML = `<div class="empty-state">${escapeGalleryImportHtml(galleryImportState.emptyMessage || '暂无导入内容')}</div>`;
        updateGalleryImportProgress();
        return;
    }

    queue.innerHTML = rows.map((item) => {
        const cover = getGalleryImportCoverUrl(item);
        const imageCount = getGalleryImportDisplayImageCount(item);
        const prompt = item.prompt_text || (item.final_prompt_id ? '已保存到 Gallery' : '未抓到提示词');
        const sourceLabel = item.author_name || item.author_handle || item.original_work_url || '未提供来源';
        const status = getGalleryImportStatusLabel(item.status);
        const failure = getGalleryImportFailureInfo(item);
        const processingStatus = String(item?.__processingStatus || '').trim();
        const pipelineStage = getGalleryImportPipelineStageLabel(item?.pipeline_stage || '');
        const attempts = Number(item?.processing_attempts || 0);
        const workerMeta = [
            pipelineStage ? `阶段：${pipelineStage}` : '',
            attempts ? `尝试：${attempts}` : '',
            item?.worker_name ? 'Worker：已领取' : '',
            item?.updated_at ? `更新：${formatGalleryImportBatchTime(item.updated_at)}` : ''
        ].filter(Boolean).join(' · ');
        const error = failure
            ? `
                <div class="gallery-import-item__error" role="status">
                    <strong>${escapeGalleryImportHtml(failure.label)}</strong>
                    <span>${escapeGalleryImportHtml(failure.message)}</span>
                    <small>${escapeGalleryImportHtml(failure.action)}</small>
                </div>
            `
            : (item.error_summary
                ? `<div class="gallery-import-item__notice">${escapeGalleryImportHtml(normalizeGalleryImportFailureMessage(item.error_summary))}</div>`
                : (processingStatus
                    ? `<div class="gallery-import-item__notice">${escapeGalleryImportHtml(processingStatus)}</div>`
                    : ''));

        return `
            <article class="gallery-import-item" data-import-item-id="${escapeGalleryImportHtml(item.id || '')}">
                <div class="gallery-import-item__media">
                    ${cover ? `<img src="${escapeGalleryImportHtml(cover)}" alt="导入预览" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
                    <span class="gallery-import-item__count">共 ${Number(imageCount) || 0} 张</span>
                </div>
                <div class="gallery-import-item__body">
                    <div class="gallery-import-item__meta">
                        <span>${Number(item.favorite_count || item.favoriteCount || 0)} 收藏</span>
                        <span class="gallery-import-item__status">${escapeGalleryImportHtml(status)}</span>
                    </div>
                    <p class="gallery-import-item__prompt">${escapeGalleryImportHtml(prompt)}</p>
                    <div class="gallery-import-item__source">${escapeGalleryImportHtml(sourceLabel)}</div>
                    ${workerMeta ? `<div class="gallery-import-item__worker">${escapeGalleryImportHtml(workerMeta)}</div>` : ''}
                    ${error}
                </div>
            </article>
        `;
    }).join('');
    updateGalleryImportProgress();
}

function setGalleryImportItems(items = [], options = {}) {
    const includeCleaned = options.includeCleaned === true;
    galleryImportState.items = (Array.isArray(items) ? items : [])
        .filter((item) => includeCleaned || String(item?.status || '') !== 'cleaned');
    if (galleryImportState.items.length) {
        setGalleryImportEmptyMessage();
    }
    renderGalleryImportQueue(galleryImportState.items);
}

function buildGalleryImportPreviewItems(items = []) {
    return (Array.isArray(items) ? items : []).map((item, index) => ({
        id: `preview-${index}`,
        ...item,
        status: getGalleryImportItemReadinessIssue(item) ? 'needs_review' : 'staged',
        favorite_count: item.favorite_count || item.favoriteCount || 0
    }));
}

function loadGalleryImportRawText(rawText = '', statusPrefix = '已读取') {
    const rawInput = document.getElementById('galleryImportRawInput');
    if (rawInput) {
        rawInput.value = String(rawText || '');
    }

    const previewItems = parseGalleryImportRawInput(rawText);
    if (!previewItems.length) {
        galleryImportState.localPreviewLocked = false;
        setGalleryImportEmptyMessage('没有读到可导入内容。请先在采集器复制诊断或下载结果，再回到这里粘贴 / 导入。');
        setGalleryImportItems([]);
        setGalleryImportRunStatus('未读到结果');
        return [];
    }

    galleryImportState.localPreviewLocked = true;
    setGalleryImportItems(buildGalleryImportPreviewItems(previewItems));
    setGalleryImportRunStatus(`${statusPrefix} ${previewItems.length} 条，点“开始任务”写入队列`);
    return previewItems;
}

function upsertGalleryImportItem(nextItem = {}) {
    const id = String(nextItem?.id || '').trim();
    if (!id) return;
    const index = galleryImportState.items.findIndex((item) => String(item?.id || '') === id);
    if (String(nextItem?.status || '') === 'cleaned') {
        if (index >= 0) {
            galleryImportState.items.splice(index, 1);
            renderGalleryImportQueue(galleryImportState.items);
        }
        return;
    }
    if (index >= 0) {
        galleryImportState.items[index] = {
            ...galleryImportState.items[index],
            ...nextItem
        };
    } else {
        galleryImportState.items.unshift(nextItem);
    }
    renderGalleryImportQueue(galleryImportState.items);
}

function isGalleryImportItemUploadable(item = {}) {
    const status = String(item?.status || '').trim();
    const finalPromptId = String(item?.final_prompt_id || item?.finalPromptId || '').trim();
    return ['staged', 'queued', 'failed'].includes(status)
        || (status === 'imported' && Boolean(finalPromptId));
}

function getGalleryImportItemReadinessIssue(item = {}) {
    const finalPromptId = String(item?.final_prompt_id || item?.finalPromptId || '').trim();
    const duplicatePromptId = String(item?.duplicate_of_prompt_id || item?.duplicateOfPromptId || '').trim();
    const promptText = String(item?.prompt_text || item?.promptText || item?.prompt || '').trim();
    const imageCount = getGalleryImportDisplayImageCount(item);
    const originalWorkUrl = String(item?.original_work_url || item?.originalWorkUrl || item?.source_url || item?.sourceUrl || '').trim();
    const authorName = String(item?.author_name || item?.authorName || item?.nickname || item?.creator || '').trim();
    const authorHandle = getGalleryImportAuthorHandle(item, originalWorkUrl);
    const status = String(item?.status || '').trim();

    if (finalPromptId || duplicatePromptId) {
        return '';
    }
    if (!promptText) {
        return '缺少提示词，已跳过';
    }
    if (!imageCount) {
        return '缺少图片，已跳过';
    }
    if (!originalWorkUrl) {
        return '缺少 X 原帖链接，已跳过';
    }
    if (!authorName) {
        return '缺少原作者昵称，已跳过';
    }
    if (!authorHandle) {
        return '缺少原作者 ID，已跳过';
    }
    if (status === 'duplicate' || duplicatePromptId) {
        return '提示词库已有重复内容，已跳过';
    }
    return '';
}

function isGalleryImportItemReadyForUpload(item = {}) {
    return !getGalleryImportItemReadinessIssue(item);
}

async function skipGalleryImportItems(items = [], reason = '信息不完整，已跳过') {
    const persistentIds = (Array.isArray(items) ? items : [])
        .map((item) => item?.id)
        .filter((id) => id && !String(id).startsWith('preview-'));

    if (!persistentIds.length) {
        return null;
    }

    const payload = await mutateGalleryImport('skip_items', {
        site: window.AdminSiteFilter?.getSiteFilter?.() || 'cn',
        item_ids: persistentIds,
        reason
    });
    (payload.items || []).forEach(upsertGalleryImportItem);
    if (payload.batch) galleryImportState.batch = payload.batch;
    return payload;
}

async function autoCleanupRejectedGalleryImportItems(batchId = galleryImportState.selectedBatchId) {
    const id = String(batchId || '').trim();
    if (!id) return { cleanedCount: 0 };
    const payload = await mutateGalleryImport('cleanup_rejected_items', {
        site: window.AdminSiteFilter?.getSiteFilter?.() || 'cn',
        batch_id: id
    });
    const cleanedIds = new Set((payload.items || []).map((item) => String(item.id || '')).filter(Boolean));
    if (cleanedIds.size) {
        galleryImportState.items = galleryImportState.items.filter((item) => !cleanedIds.has(String(item.id || '')));
        if (payload.batch) galleryImportState.batch = payload.batch;
        renderGalleryImportQueue(galleryImportState.items);
        renderGalleryImportBatchTracker();
    }
    return payload;
}

async function failGalleryImportItems(items = [], reason = '已保存，但发布流程未完成') {
    const persistentIds = (Array.isArray(items) ? items : [])
        .map((item) => item?.id)
        .filter((id) => id && !String(id).startsWith('preview-'));

    if (!persistentIds.length) {
        return null;
    }

    const payload = await mutateGalleryImport('fail_items', {
        site: window.AdminSiteFilter?.getSiteFilter?.() || 'cn',
        item_ids: persistentIds,
        reason
    });
    (payload.items || []).forEach(upsertGalleryImportItem);
    if (payload.batch) galleryImportState.batch = payload.batch;
    return payload;
}

function hasMeaningfulGalleryImportAnalysisValue(value) {
    if (Array.isArray(value)) {
        return value.some((entry) => hasMeaningfulGalleryImportAnalysisValue(entry));
    }
    if (value && typeof value === 'object') {
        return Object.values(value).some((entry) => hasMeaningfulGalleryImportAnalysisValue(entry));
    }
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    return value !== undefined && value !== null && value !== false;
}

function isGalleryImportGeneratedTitle(value = '') {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    return Boolean(title) && !/^(?:untitled prompt|未命名 prompt|未命名提示词)$/i.test(title);
}

function getGalleryImportPromptAnalysisChecks(prompt = {}) {
    const aiTags = prompt?.ai_tags && typeof prompt.ai_tags === 'object' && !Array.isArray(prompt.ai_tags)
        ? prompt.ai_tags
        : (prompt?.aiTags && typeof prompt.aiTags === 'object' && !Array.isArray(prompt.aiTags)
            ? prompt.aiTags
            : {});
    const tags = Array.isArray(prompt?.tags) ? prompt.tags : [];
    return {
        title: isGalleryImportGeneratedTitle(prompt?.title),
        category: tags.some((value) => String(value || '').trim()),
        description: promptHasVisibleCopy(prompt?.description),
        objects: hasMeaningfulGalleryImportAnalysisValue(aiTags.objects),
        scenes: hasMeaningfulGalleryImportAnalysisValue(aiTags.scenes),
        styles: hasMeaningfulGalleryImportAnalysisValue(aiTags.styles),
        mood: hasMeaningfulGalleryImportAnalysisValue(aiTags.mood),
        useCase: hasMeaningfulGalleryImportAnalysisValue(aiTags.useCase),
        commercial: hasMeaningfulGalleryImportAnalysisValue(aiTags.commercial),
        difficulty: hasMeaningfulGalleryImportAnalysisValue(aiTags.difficulty),
        dominantColors: hasMeaningfulGalleryImportAnalysisValue(
            prompt?.dominant_colors || prompt?.dominantColors
        )
    };
}

function getGalleryImportMissingAnalysisLabels(prompt = {}) {
    const labels = {
        title: '标题',
        category: '分类',
        description: '描述',
        objects: '对象属性',
        scenes: '场景属性',
        styles: '风格属性',
        mood: '氛围属性',
        useCase: '用途属性',
        commercial: '商业属性',
        difficulty: '难度属性',
        dominantColors: '主色'
    };
    return Object.entries(getGalleryImportPromptAnalysisChecks(prompt))
        .filter(([, completed]) => !completed)
        .map(([key]) => labels[key] || key);
}

function hasGalleryImportPromptAnalysis(prompt = {}) {
    return getGalleryImportMissingAnalysisLabels(prompt).length === 0;
}

function getGalleryImportMissingBilingualLabels(prompt = {}) {
    const labels = {
        title_zh: '中文标题',
        title_en: '英文标题',
        description_zh: '中文描述',
        description_en: '英文描述',
        prompt_text_zh: '中文提示词',
        prompt_text_en: '英文提示词'
    };
    return Object.entries(labels)
        .filter(([field]) => !promptHasVisibleCopy(prompt?.[field]))
        .map(([, label]) => label);
}

function getGalleryImportPromptProcessingState(prompt = {}, settings = {}) {
    const analysisRequired = true;
    const missingAnalysis = analysisRequired ? getGalleryImportMissingAnalysisLabels(prompt) : [];
    const analyzed = !analysisRequired || missingAnalysis.length === 0;
    const languageCoverage = getPromptLanguageCoverage(prompt);
    const missingBilingual = getGalleryImportMissingBilingualLabels(prompt);
    const bilingual = missingBilingual.length === 0;
    const published = getPromptAdminOpsData(prompt).status === 'live'
        && isGalleryImportGeneratedTitle(prompt?.title);
    const nextStage = !analyzed
        ? 'analysis'
        : (!bilingual ? 'bilingual' : (!published ? 'publish' : 'cleanup'));

    return {
        nextStage,
        analyzed,
        bilingual,
        published,
        analysisRequired,
        languageCoverage,
        missingAnalysis,
        missingBilingual
    };
}

function buildGalleryImportProcessingStatusReason(processingState = {}) {
    switch (processingState.nextStage) {
        case 'analysis':
            return `图片分析未完成：${(processingState.missingAnalysis || []).join('、') || '完整分析属性'}尚未保存，点击“上传队列”将从图片分析继续`;
        case 'bilingual':
            return `双语补全未完成：${(processingState.missingBilingual || []).join('、') || '双语字段'}尚未补齐，点击“上传队列”将从双语补全继续`;
        case 'publish':
            return '发布未完成：图片分析和双语补全已完成，点击“上传队列”将继续发布';
        case 'cleanup':
            return '暂存清理未完成：作品已上线，只需清理抓取暂存';
        default:
            return '后续处理未完成：点击“上传队列”继续';
    }
}

async function runGalleryImportPostSavePipeline(prompt = {}, item = {}, context = {}) {
    const writableSite = context.site || window.AdminSiteFilter?.getSiteFilter?.() || 'cn';
    const settings = context.settings || {};
    const currentIndex = Number(context.index || 0);
    const total = Number(context.total || 0);
    const prefix = total ? `${currentIndex} / ${total}` : '';
    let processingState = context.processingState
        || getGalleryImportPromptProcessingState(prompt, settings);
    const reportStatus = typeof context.reportStatus === 'function'
        ? context.reportStatus
        : setGalleryImportRunStatus;
    const onPressureSignal = typeof context.onPressureSignal === 'function'
        ? context.onPressureSignal
        : null;
    let currentPrompt = prompt;
    const refreshPrompt = async () => {
        const refreshed = await fetchAdminPromptItem(currentPrompt.id, {
            site: writableSite,
            hydrateBilingual: true
        });
        if (!refreshed?.row) {
            throw new Error('处理后无法读取 Gallery 作品');
        }
        currentPrompt = refreshed.row;
        processingState = getGalleryImportPromptProcessingState(currentPrompt, settings);
        return currentPrompt;
    };

    if (settings.analyze_after_save && typeof reanalyzeSinglePrompt === 'function' && !processingState.analyzed) {
        if (context.justSaved) {
            reportStatus(`等待图片就绪 ${prefix}`.trim());
            await sleep(GALLERY_IMPORT_STAGE_GAP_MS);
        }
        try {
            await runGalleryImportPipelineStageWithRetry({
                label: '图片分析',
                index: currentIndex,
                total,
                maxAttempts: GALLERY_IMPORT_ANALYSIS_MAX_ATTEMPTS,
                reportStatus,
                onRetryableError: onPressureSignal,
                operation: async () => {
                    currentPrompt = await reanalyzeSinglePrompt(currentPrompt, writableSite);
                    await refreshPrompt();
                    if (!processingState.analyzed) {
                        throw new Error(`分析结果不完整：${processingState.missingAnalysis.join('、')}`);
                    }
                    return currentPrompt;
                }
            });
        } catch (error) {
            throw createGalleryImportStageError('analysis', error);
        }
        await sleep(GALLERY_IMPORT_STAGE_GAP_MS);
    }

    if (!processingState.bilingual) {
        let bilingualResult;
        try {
            bilingualResult = await runGalleryImportPipelineStageWithRetry({
                label: '双语补全',
                index: currentIndex,
                total,
                maxAttempts: GALLERY_IMPORT_BILINGUAL_MAX_ATTEMPTS,
                reportStatus,
                onRetryableError: onPressureSignal,
                operation: async () => {
                    const result = await completePromptBilingualFields(currentPrompt, writableSite, {
                        mode: 'full'
                    });
                    currentPrompt = result.row || currentPrompt;
                    await refreshPrompt();
                    if (!processingState.bilingual) {
                        throw new Error(`双语结果未完整保存：${processingState.missingBilingual.join('、')}`);
                    }
                    return result;
                }
            });
        } catch (error) {
            throw createGalleryImportStageError('bilingual', error);
        }
        currentPrompt = bilingualResult.row || currentPrompt;
        await refreshPrompt();
        await sleep(GALLERY_IMPORT_STAGE_GAP_MS);
    }

    if (!processingState.published) {
        reportStatus(`发布中 ${prefix}`.trim());
        try {
            currentPrompt = await setPromptAdminStatus(currentPrompt, 'live', writableSite);
            await refreshPrompt();
            if (!processingState.published) {
                throw new Error('数据库仍未确认作品为已上线状态');
            }
        } catch (error) {
            throw createGalleryImportStageError('publish', error);
        }
    }

    await refreshPrompt();
    if (processingState.nextStage !== 'cleanup') {
        throw createGalleryImportStageError(
            processingState.nextStage,
            new Error(buildGalleryImportProcessingStatusReason(processingState))
        );
    }

    if (item?.id) {
        try {
            const cleanupPayload = await mutateGalleryImport('cleanup_items', {
                site: writableSite,
                item_ids: [item.id]
            });
            (cleanupPayload.items || []).forEach(upsertGalleryImportItem);
            if (cleanupPayload.batch) galleryImportState.batch = cleanupPayload.batch;
        } catch (error) {
            throw createGalleryImportStageError('cleanup', error);
        }
    }

    return currentPrompt;
}

async function loadGalleryImportSavedPrompt(item = {}, writableSite = getAdminPromptsReadSite()) {
    const finalPromptId = String(item?.final_prompt_id || item?.finalPromptId || '').trim();
    const duplicatePromptId = String(item?.duplicate_of_prompt_id || item?.duplicateOfPromptId || '').trim();
    const promptId = finalPromptId || duplicatePromptId;
    if (!promptId) return null;
    const payload = await fetchAdminPromptItem(promptId, {
        site: writableSite,
        hydrateBilingual: true
    });
    if (!payload?.row) {
        throw new Error('已保存的 Gallery 作品读取失败');
    }
    if (!finalPromptId) {
        const aiTags = payload.row?.ai_tags && typeof payload.row.ai_tags === 'object' && !Array.isArray(payload.row.ai_tags)
            ? payload.row.ai_tags
            : {};
        const adminMetadata = aiTags.admin && typeof aiTags.admin === 'object' && !Array.isArray(aiTags.admin)
            ? aiTags.admin
            : {};
        const isAssistantPrompt = String(adminMetadata.source || '').trim() === 'prompt_import'
            || /meigen\s*导入助手/i.test(String(adminMetadata.note || ''));
        if (!isAssistantPrompt) {
            return null;
        }
    }
    return payload.row;
}

function getGalleryImportSavedPromptReferenceId(item = {}) {
    return String(
        item?.final_prompt_id
        || item?.finalPromptId
        || item?.duplicate_of_prompt_id
        || item?.duplicateOfPromptId
        || ''
    ).trim();
}

async function loadRecentGalleryImportSavedItems(limit = 20) {
    const payload = await fetchGalleryImportApi({ limit });
    const batches = Array.isArray(payload?.batches) ? payload.batches : [];
    const details = await Promise.all(batches.map((batch) => (
        fetchGalleryImportApi({
            batchId: batch.id,
            limit: 100
        }).catch((error) => {
            console.warn('[GalleryImport] Failed to inspect an earlier import batch:', batch?.id, error);
            return null;
        })
    )));
    const byPromptId = new Map();
    details.forEach((detail) => {
        (detail?.items || []).forEach((item) => {
            const promptId = getGalleryImportSavedPromptReferenceId(item);
            if (!promptId || byPromptId.has(promptId)) return;
            byPromptId.set(promptId, item);
        });
    });
    return [...byPromptId.values()];
}

async function stageGalleryImportItems(items = []) {
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: 'Gallery 导入助手' });
    if (!writableSite) return null;

    const settings = getGalleryImportSettings();
    const wasLocalPreviewLocked = galleryImportState.localPreviewLocked;
    const payload = await mutateGalleryImport('stage_items', {
        site: writableSite,
        source: 'meigen',
        mode: galleryImportState.mode,
        settings,
        batch_id: wasLocalPreviewLocked ? '' : (galleryImportState.batch?.id || ''),
        items
    });
    galleryImportState.localPreviewLocked = false;
    galleryImportState.batch = payload.batch || galleryImportState.batch;
    if (payload.batch) {
        galleryImportState.selectedBatchId = payload.batch.id;
        galleryImportState.batchSelectionLocked = false;
        upsertGalleryImportBatch(payload.batch);
        renderGalleryImportBatchTracker();
    }
    setGalleryImportItems(payload.items || []);
    const skippedDuplicateCount = Number(payload.skippedDuplicateCount || 0);
    if (skippedDuplicateCount > 0) {
        setGalleryImportRunStatus(`已入队 ${payload.items?.length || 0} 条，提示词库重复自动跳过 ${skippedDuplicateCount} 条`);
        showAdminStudioToast(`提示词库已有 ${skippedDuplicateCount} 条，已自动跳过`, 'info');
    }
    return payload;
}

function upsertGalleryImportBatch(batch = {}) {
    const id = String(batch?.id || '').trim();
    if (!id) return;
    const index = galleryImportState.batches.findIndex((item) => String(item?.id || '') === id);
    if (index >= 0) {
        galleryImportState.batches[index] = { ...galleryImportState.batches[index], ...batch };
    } else {
        galleryImportState.batches.unshift(batch);
    }
}

async function loadGalleryImportBatchById(batchId, options = {}) {
    const id = String(batchId || '').trim();
    if (!id) return null;
    const detail = await fetchGalleryImportApi({ batchId: id, limit: 100 });
    galleryImportState.batch = detail.batch || galleryImportState.batches.find((batch) => batch.id === id) || null;
    galleryImportState.selectedBatchId = galleryImportState.batch?.id || id;
    if (galleryImportState.batch) upsertGalleryImportBatch(galleryImportState.batch);
    setGalleryImportItems(detail.items || [], {
        includeCleaned: options.includeCleaned === true
    });
    renderGalleryImportBatchTracker();
    if (!options.silent) {
        const stats = getGalleryImportBatchStats(galleryImportState.batch);
        setGalleryImportRunStatus(`批次 ${id.slice(0, 8)} 已刷新：总数 ${stats.total}，待处理 ${stats.pending}，失败 ${stats.failed}`);
    }
    return detail;
}

async function loadLatestGalleryImportBatch(options = {}) {
    if (galleryImportState.localPreviewLocked && options.force !== true) {
        renderGalleryImportQueue(galleryImportState.items);
        if (!options.silent) setGalleryImportRunStatus('本地预览已锁定，点“开始任务”写入新批次');
        return { batch: null, items: galleryImportState.items, localPreview: true };
    }
    const site = window.AdminSiteFilter?.getSiteFilter?.() || 'cn';
    const payload = await fetchGalleryImportApi({ limit: 30, site });
    galleryImportState.batches = Array.isArray(payload.batches) ? payload.batches : [];
    const batch = selectGalleryImportBatch(galleryImportState.batches, {
        preferredBatchId: galleryImportState.batchSelectionLocked
            ? galleryImportState.selectedBatchId
            : (options.preferredBatchId || galleryImportState.selectedBatchId),
        preferPending: options.preferPending === true && !galleryImportState.batchSelectionLocked
    });
    if (!batch) {
        galleryImportState.batch = null;
        galleryImportState.selectedBatchId = '';
        renderGalleryImportBatchTracker();
        const hasPreviewItems = galleryImportState.items.some((item) => String(item?.id || '').startsWith('preview-'));
        setGalleryImportEmptyMessage('还没有队列内容。请先在采集器点“送入队列”；如果复制的是诊断或下载文件，点“粘贴结果”或“导入抓取结果”，再点“开始任务”。');
        if (!options.silent) {
            setGalleryImportRunStatus(hasPreviewItems ? '预览还未写入队列' : '还没有送入队列');
        }
        if (hasPreviewItems) {
            renderGalleryImportQueue(galleryImportState.items);
        } else {
            setGalleryImportItems([]);
        }
        return null;
    }
    galleryImportState.batch = batch;
    galleryImportState.selectedBatchId = batch.id;
    renderGalleryImportBatchTracker();
    return loadGalleryImportBatchById(batch.id, options);
}

function isGalleryImportItemAutoUploadable(item = {}) {
    const status = String(item?.status || '').trim();
    return status === 'staged' || status === 'queued';
}

function setGalleryImportAutoDetectionEnabled(enabled, options = {}) {
    galleryImportState.autoDetectionEnabled = Boolean(enabled);
    const toggle = document.getElementById('galleryImportAutoDetectQueue');
    if (toggle) toggle.checked = galleryImportState.autoDetectionEnabled;
    if (options.persist !== false) {
        try {
            localStorage.setItem(
                GALLERY_IMPORT_AUTO_DETECT_STORAGE_KEY,
                galleryImportState.autoDetectionEnabled ? '1' : '0'
            );
        } catch (_) {
            // Local storage may be unavailable in hardened browser contexts.
        }
    }
    if (galleryImportState.autoDetectionTimer) {
        clearInterval(galleryImportState.autoDetectionTimer);
        galleryImportState.autoDetectionTimer = 0;
    }
    if (galleryImportState.autoDetectionEnabled) {
        galleryImportState.autoDetectionTimer = window.setInterval(() => {
            void runGalleryImportAutoDetectionCycle();
        }, GALLERY_IMPORT_AUTO_DETECT_INTERVAL_MS);
        if (options.runImmediately !== false) {
            void runGalleryImportAutoDetectionCycle();
        }
    }
}

async function runGalleryImportAutoDetectionCycle() {
    if (!galleryImportState.autoDetectionEnabled
        || galleryImportState.localPreviewLocked
        || galleryImportState.autoDetectionInFlight
        || galleryImportState.running
        || galleryImportState.uploadInFlight
        || galleryImportState.statusRefreshInFlight) {
        return null;
    }
    const runCycle = async () => {
        if (!galleryImportState.autoDetectionEnabled || galleryImportState.autoDetectionInFlight) return null;
        galleryImportState.autoDetectionInFlight = true;
        try {
            await loadLatestGalleryImportBatch({ silent: true, preferPending: true });
            const hasNewQueueItems = galleryImportState.items.some(isGalleryImportItemAutoUploadable);
            let batchStats = getGalleryImportBatchStats(galleryImportState.batch);
            if (!hasNewQueueItems) {
                const batchId = String(galleryImportState.batch?.id || '').trim();
                const cleanupPayload = await autoCleanupRejectedGalleryImportItems(batchId);
                if (cleanupPayload.cleanedCount && batchId) {
                    await loadGalleryImportBatchById(batchId, { silent: true });
                    batchStats = getGalleryImportBatchStats(galleryImportState.batch);
                    setGalleryImportRunStatus(`批次 ${batchId.slice(0, 8)} 已自动清理 ${cleanupPayload.cleanedCount} 条不完整或不合规卡片`);
                }
                if (batchStats.failed || batchStats.needsReview) {
                    setGalleryImportRunStatus(
                        `批次 ${String(galleryImportState.batch?.id || '').slice(0, 8)} 需要处理：失败 ${batchStats.failed}，需复核 ${batchStats.needsReview}`
                    );
                } else if (batchStats.total > 0 && batchStats.completed >= batchStats.total) {
                    setGalleryImportRunStatus(`批次 ${String(galleryImportState.batch?.id || '').slice(0, 8)} 已处理完成`);
                }
                return { pendingCount: 0, batch: galleryImportState.batch };
            }
            const pendingCount = galleryImportState.items.filter(isGalleryImportItemAutoUploadable).length;
            setGalleryImportRunStatus(
                `批次 ${String(galleryImportState.batch?.id || '').slice(0, 8)}：服务端 Worker 正在处理 ${pendingCount} 条，可安全关闭 Admin Studio`
            );
            return { pendingCount, batch: galleryImportState.batch };
        } catch (error) {
            console.warn('[GalleryImport] Auto queue detection failed:', error);
            setGalleryImportRunStatus(`自动检测失败：${normalizeGalleryImportFailureMessage(error)}`);
            return null;
        } finally {
            galleryImportState.autoDetectionInFlight = false;
        }
    };
    if (navigator.locks?.request) {
        return navigator.locks.request(
            GALLERY_IMPORT_AUTO_DETECT_LOCK_NAME,
            { ifAvailable: true },
            (lock) => lock ? runCycle() : null
        );
    }
    return runCycle();
}

async function refreshGalleryImportProcessingStatus(options = {}) {
    if (galleryImportState.statusRefreshInFlight || galleryImportState.uploadInFlight) {
        if (!options.silent) {
            showAdminStudioToast('当前已有导入任务正在处理，请稍候', 'info');
        }
        return null;
    }

    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: 'Gallery 导入助手' });
    if (!writableSite) return null;

    galleryImportState.statusRefreshInFlight = true;
    setGalleryImportRunStatus('正在读取 Manage 当前状态...');
    let latestBatch = null;

    try {
        await loadLatestGalleryImportBatch();
        latestBatch = galleryImportState.batch;
        const savedItems = await loadRecentGalleryImportSavedItems(20);
        if (!savedItems.length) {
            setGalleryImportRunStatus('当前队列没有已保存到 Gallery 的作品');
            if (!options.silent) {
                showAdminStudioToast('当前队列没有可同步处理状态的作品', 'info');
            }
            return {
                total: 0,
                pending: 0,
                completed: 0,
                failed: 0
            };
        }

        const settings = getGalleryImportSettings();
        const stageCounts = {
            analysis: 0,
            bilingual: 0,
            publish: 0,
            cleanup: 0
        };
        let failed = 0;

        for (let index = 0; index < savedItems.length; index += 1) {
            const item = savedItems[index];
            setGalleryImportRunStatus(`检查处理状态 ${index + 1} / ${savedItems.length}`);
            try {
                const prompt = await loadGalleryImportSavedPrompt(item, writableSite);
                if (!prompt) {
                    continue;
                }
                const processingState = getGalleryImportPromptProcessingState(prompt, settings);
                stageCounts[processingState.nextStage] += 1;

                if (processingState.nextStage === 'cleanup') {
                    if (String(item?.status || '') !== 'cleaned') {
                        const cleanupPayload = await mutateGalleryImport('cleanup_items', {
                            site: writableSite,
                            item_ids: [item.id]
                        });
                        (cleanupPayload.items || []).forEach(upsertGalleryImportItem);
                        if (cleanupPayload.batch) galleryImportState.batch = cleanupPayload.batch;
                    }
                    continue;
                }

                const reason = buildGalleryImportProcessingStatusReason(processingState);
                await failGalleryImportItems([item], reason);
            } catch (error) {
                failed += 1;
                const reason = `后续处理失败：状态读取失败，${normalizeGalleryImportFailureMessage(error)}`;
                console.warn('[GalleryImport] Failed to refresh saved prompt state:', error);
                try {
                    await failGalleryImportItems([item], reason);
                } catch (persistError) {
                    console.warn('[GalleryImport] Failed to persist state refresh error:', persistError);
                    upsertGalleryImportItem({
                        ...item,
                        status: 'failed',
                        error_summary: reason
                    });
                }
            }
        }

        const pending = stageCounts.analysis + stageCounts.bilingual + stageCounts.publish;
        const completed = stageCounts.cleanup;
        const stageSummary = [
            stageCounts.analysis ? `待分析 ${stageCounts.analysis} 条` : '',
            stageCounts.bilingual ? `待双语 ${stageCounts.bilingual} 条` : '',
            stageCounts.publish ? `待发布 ${stageCounts.publish} 条` : '',
            completed ? `已完成并清理 ${completed} 条` : '',
            failed ? `状态读取失败 ${failed} 条` : ''
        ].filter(Boolean).join('，');
        setGalleryImportRunStatus(`状态已刷新${stageSummary ? `：${stageSummary}` : ''}`);
        if (!options.silent) {
            showAdminStudioToast(
                stageSummary ? `处理状态已同步：${stageSummary}` : '处理状态已同步',
                failed ? 'warning' : 'success'
            );
        }
        return {
            total: savedItems.length,
            pending,
            completed,
            failed,
            stageCounts
        };
    } finally {
        if (latestBatch) {
            galleryImportState.batch = latestBatch;
        }
        galleryImportState.statusRefreshInFlight = false;
    }
}

async function runGalleryImportUploadQueue(options = {}) {
    if (galleryImportState.uploadInFlight || galleryImportState.statusRefreshInFlight) return;
    const writableSite = window.AdminSiteFilter?.requireWritableSite?.({ label: 'Gallery 导入助手' });
    if (!writableSite) return;

    if (!options.skipStatusRefresh) {
        try {
            await refreshGalleryImportProcessingStatus({ silent: true });
        } catch (error) {
            console.warn('[GalleryImport] Pre-upload status refresh failed, continuing with visible queue:', error);
        }
    }

    const uploadableMatcher = options.automatic
        ? isGalleryImportItemAutoUploadable
        : isGalleryImportItemUploadable;
    let uploadable = galleryImportState.items.filter(uploadableMatcher);
    if (!uploadable.length && !galleryImportState.items.length) {
        await loadLatestGalleryImportBatch();
        uploadable = galleryImportState.items.filter(uploadableMatcher);
    }

    if (!uploadable.length) {
        showAdminStudioToast('没有需要上传的内容', 'info');
        return;
    }

    const skippedItems = [];
    const readyItems = [];
    const seenPromptIds = new Set();
    const seenPromptTexts = new Set();
    const seenSourceUrls = new Set();
    uploadable.forEach((item) => {
        const issue = getGalleryImportItemReadinessIssue(item);
        if (issue) {
            skippedItems.push({ ...item, status: 'skipped', error_summary: issue });
            return;
        }
        const normalizedPromptText = String(item?.prompt_text || item?.promptText || item?.prompt || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .trim();
        const normalizedSourceUrl = String(
            item?.original_work_url || item?.originalWorkUrl || item?.source_url || item?.sourceUrl || ''
        ).trim().toLowerCase();
        const normalizedPromptId = getGalleryImportSavedPromptReferenceId(item);
        if (
            (normalizedPromptId && seenPromptIds.has(normalizedPromptId))
            ||
            (normalizedPromptText && seenPromptTexts.has(normalizedPromptText))
            || (normalizedSourceUrl && seenSourceUrls.has(normalizedSourceUrl))
        ) {
            skippedItems.push({
                ...item,
                status: 'skipped',
                error_summary: '当前队列已有相同作品或提示词，已跳过'
            });
            return;
        }
        if (normalizedPromptId) {
            seenPromptIds.add(normalizedPromptId);
        }
        if (normalizedPromptText) {
            seenPromptTexts.add(normalizedPromptText);
        }
        if (normalizedSourceUrl) {
            seenSourceUrls.add(normalizedSourceUrl);
        }
        readyItems.push(item);
    });

    if (skippedItems.length) {
        skippedItems.forEach(upsertGalleryImportItem);
        try {
            await skipGalleryImportItems(skippedItems, '必填信息缺失或重复，已跳过');
        } catch (skipError) {
            console.warn('[GalleryImport] Failed to persist skipped items:', skipError);
        }
    }

    if (!readyItems.length) {
        const cleanupPayload = await autoCleanupRejectedGalleryImportItems(galleryImportState.selectedBatchId);
        setGalleryImportRunStatus(`完成：跳过 ${skippedItems.length} 条，暂无可发布内容`);
        showAdminStudioToast(
            `没有可发布的完整内容；已自动清理 ${cleanupPayload.cleanedCount || skippedItems.length} 条不完整或重复卡片`,
            'warning'
        );
        return;
    }

    galleryImportState.uploadInFlight = true;
    const latestBatch = galleryImportState.batch;
    const settings = getGalleryImportSettings();
    const parallelismCeiling = Math.max(
        1,
        Math.min(Number(settings.parallelism || GALLERY_IMPORT_DEFAULT_PARALLELISM), readyItems.length, GALLERY_IMPORT_MAX_PARALLELISM)
    );
    let adaptiveParallelism = Math.min(
        parallelismCeiling,
        GALLERY_IMPORT_ADAPTIVE_INITIAL_PARALLELISM
    );
    let stableCompletions = 0;
    let pressureCooldownUntil = 0;
    setGalleryImportRunStatus(`自适应并发准备中：当前 ${adaptiveParallelism}，上限 ${parallelismCeiling}`);
    let completed = 0;
    let active = 0;
    const failureStageCounts = {};
    const updateParallelStatus = (itemStatus = '') => {
        setGalleryImportRunStatus(
            `${itemStatus ? `${itemStatus} · ` : ''}总进度 ${completed} / ${readyItems.length}，处理中 ${active} 条，并发阈值 ${adaptiveParallelism} / ${parallelismCeiling}`
        );
    };
    const processGalleryImportItem = async (item, index) => {
        active += 1;
        let pipelineItem = item;
        const reportStatus = (statusText = '') => {
            upsertGalleryImportItem({
                ...pipelineItem,
                status: 'uploading',
                error_summary: '',
                __processingStatus: statusText
            });
            updateParallelStatus(statusText);
        };

        let pipelinePrompt = null;
        const hadSavedPromptReference = Boolean(getGalleryImportSavedPromptReferenceId(item));
        let justSaved = false;
        let skipped = false;
        let pressureSignaled = false;
        try {
            reportStatus(`保存图片 ${index + 1} / ${readyItems.length}`);
            pipelinePrompt = await loadGalleryImportSavedPrompt(item, writableSite);
            if (pipelinePrompt) {
                const recoveredPromptId = String(pipelinePrompt.id || '').trim();
                if (
                    recoveredPromptId
                    && !String(pipelineItem?.final_prompt_id || pipelineItem?.finalPromptId || '').trim()
                ) {
                    pipelineItem = {
                        ...pipelineItem,
                        final_prompt_id: recoveredPromptId,
                        duplicate_of_prompt_id: ''
                    };
                }
                reportStatus(`检查当前状态 ${index + 1} / ${readyItems.length}`);
            } else {
                if (getGalleryImportSavedPromptReferenceId(item)) {
                    skippedItems.push({
                        ...item,
                        status: 'skipped',
                        error_summary: '提示词库已有重复内容，已跳过'
                    });
                    skipped = true;
                    return {
                        published: 0,
                        savedOnly: 0,
                        failed: 0
                    };
                }
                const payload = await mutateGalleryImport('upload_item', {
                    site: writableSite,
                    item_id: item.id,
                    default_status: settings.default_status,
                    cleanup_after_pipeline: true
                });
                if (payload.item) {
                    pipelineItem = payload.item;
                    upsertGalleryImportItem(payload.item);
                }
                if (payload.batch) galleryImportState.batch = payload.batch;
                if (payload.skipped) {
                    skippedItems.push(payload.item || item);
                    skipped = true;
                    return {
                        published: 0,
                        savedOnly: 0,
                        failed: 0
                    };
                }
                if (payload.error || !payload.prompt) {
                    throw new Error(payload.error || '上传完成后没有读到 Gallery 作品');
                }
                pipelinePrompt = payload.prompt;
                justSaved = true;
            }

            const processingState = getGalleryImportPromptProcessingState(pipelinePrompt, settings);
            const stageLabel = GALLERY_IMPORT_FAILURE_STAGES[processingState.nextStage]?.label || '后续处理';
            reportStatus(
                processingState.nextStage === 'cleanup'
                    ? `已完成，清理暂存 ${index + 1} / ${readyItems.length}`
                    : `${stageLabel} ${index + 1} / ${readyItems.length}`
            );
            await runGalleryImportPostSavePipeline(pipelinePrompt, pipelineItem, {
                site: writableSite,
                settings,
                index: index + 1,
                total: readyItems.length,
                justSaved,
                processingState,
                reportStatus,
                onPressureSignal: () => {
                    pressureSignaled = true;
                }
            });
            return {
                published: 1,
                savedOnly: 0,
                failed: 0,
                pressureLimited: pressureSignaled
            };
        } catch (error) {
            const pipelineError = error?.galleryImportStage
                ? error
                : createGalleryImportStageError(
                    pipelinePrompt ? 'unknown' : (hadSavedPromptReference ? 'lookup' : 'upload'),
                    error
                );
            const failureStage = String(pipelineError?.galleryImportStage || 'unknown');
            failureStageCounts[failureStage] = (failureStageCounts[failureStage] || 0) + 1;
            const failureMessage = normalizeGalleryImportFailureMessage(
                pipelineError?.message || pipelineError,
                pipelinePrompt ? '已保存，但发布流程未完成' : '上传失败'
            );
            console.warn('[GalleryImport] Import pipeline failed:', pipelineError);
            if (pipelinePrompt) {
                try {
                    await failGalleryImportItems([pipelineItem], failureMessage);
                } catch (failPersistError) {
                    console.warn('[GalleryImport] Failed to persist post-save failure:', failPersistError);
                }
            }
            upsertGalleryImportItem({
                ...pipelineItem,
                status: 'failed',
                error_summary: failureMessage,
                __processingStatus: ''
            });
            return {
                published: 0,
                savedOnly: pipelinePrompt ? 1 : 0,
                failed: 1,
                pressureLimited: pressureSignaled || isGalleryImportPipelineRetryableError(pipelineError)
            };
        } finally {
            active = Math.max(0, active - 1);
            completed += 1;
            updateParallelStatus(skipped ? '已跳过' : '');
        }
    };

    const results = new Array(readyItems.length);
    let nextIndex = 0;
    const runningTasks = new Set();
    const applyAdaptivePressure = (result = {}) => {
        if (result.pressureLimited) {
            const previousParallelism = adaptiveParallelism;
            adaptiveParallelism = Math.max(
                GALLERY_IMPORT_ADAPTIVE_MIN_PARALLELISM,
                Math.floor(adaptiveParallelism / 2)
            );
            stableCompletions = 0;
            pressureCooldownUntil = Date.now() + GALLERY_IMPORT_ADAPTIVE_COOLDOWN_MS;
            if (adaptiveParallelism < previousParallelism) {
                updateParallelStatus(`检测到压力，并发 ${previousParallelism} → ${adaptiveParallelism}，冷却 6 秒`);
            }
            return;
        }
        if (Number(result.failed || 0) > 0) {
            stableCompletions = 0;
            return;
        }
        stableCompletions += 1;
        if (stableCompletions >= adaptiveParallelism && adaptiveParallelism < parallelismCeiling) {
            adaptiveParallelism += 1;
            stableCompletions = 0;
            updateParallelStatus(`运行稳定，并发阈值提升至 ${adaptiveParallelism}`);
        }
    };
    const launchAdaptiveTask = (index) => {
        let taskPromise;
        taskPromise = processGalleryImportItem(readyItems[index], index)
            .then((result) => {
                results[index] = result;
                applyAdaptivePressure(result);
            })
            .finally(() => {
                runningTasks.delete(taskPromise);
            });
        runningTasks.add(taskPromise);
    };
    try {
        while (nextIndex < readyItems.length || runningTasks.size > 0) {
            const cooldownRemaining = Math.max(0, pressureCooldownUntil - Date.now());
            if (
                nextIndex < readyItems.length
                && runningTasks.size < adaptiveParallelism
                && cooldownRemaining <= 0
            ) {
                launchAdaptiveTask(nextIndex);
                nextIndex += 1;
                if (nextIndex < readyItems.length) {
                    await sleep(GALLERY_IMPORT_ADAPTIVE_LAUNCH_GAP_MS);
                }
                continue;
            }
            if (runningTasks.size > 0) {
                await Promise.race(runningTasks);
                continue;
            }
            if (cooldownRemaining > 0) {
                await sleep(Math.min(cooldownRemaining, GALLERY_IMPORT_ADAPTIVE_COOLDOWN_MS));
            }
        }
    } finally {
        if (latestBatch) {
            galleryImportState.batch = latestBatch;
        }
        galleryImportState.uploadInFlight = false;
    }
    const published = results.reduce((sum, result) => sum + Number(result?.published || 0), 0);
    const savedOnly = results.reduce((sum, result) => sum + Number(result?.savedOnly || 0), 0);
    const failed = results.reduce((sum, result) => sum + Number(result?.failed || 0), 0);
    const needsAction = failed + skippedItems.length;
    const failureBreakdown = Object.entries(failureStageCounts)
        .filter(([, count]) => Number(count) > 0)
        .map(([stage, count]) => `${GALLERY_IMPORT_FAILURE_STAGES[stage]?.label || '后续处理'}失败 ${count} 条`)
        .join('，');
    setGalleryImportRunStatus(
        `完成：已发布 ${published} 条，跳过 ${skippedItems.length} 条，需要处理 ${failed} 条${failureBreakdown ? `（${failureBreakdown}）` : ''}`
    );
    const savedOnlyText = savedOnly ? `，其中 ${savedOnly} 条已保存但未完成发布` : '';
    showAdminStudioToast(
        `导入完成：已发布 ${published} 条，跳过 ${skippedItems.length} 条，需要处理 ${failed} 条${failureBreakdown ? `（${failureBreakdown}）` : ''}${savedOnlyText}`,
        published && !needsAction ? 'success' : (published ? 'warning' : 'error')
    );
    markHomepagePromptPoolUpdated();
    await loadAdminPrompts({ force: true, replaceExisting: true });
    try {
        const cleanupPayload = await autoCleanupRejectedGalleryImportItems(latestBatch?.id || galleryImportState.selectedBatchId);
        if (cleanupPayload.cleanedCount) {
            showAdminStudioToast(`任务结束，已自动清理 ${cleanupPayload.cleanedCount} 条不完整或不合规卡片`, 'info');
        }
    } catch (cleanupError) {
        console.warn('[GalleryImport] Automatic rejected-item cleanup failed:', cleanupError);
        showAdminStudioToast('任务已完成，但不完整卡片自动清理失败，可稍后刷新处理状态重试', 'warning');
    }
}

async function startGalleryImportTask() {
    if (galleryImportState.running) return;
    galleryImportState.running = true;
    setGalleryImportRunStatus('准备中...');

    try {
        if (galleryImportState.mode === 'upload_only') {
            await runGalleryImportUploadQueue();
            return;
        }

        const items = getGalleryImportItemsFromInput();
        if (!items.length) {
            showAdminStudioToast('请先导入抓取结果', 'warning');
            setGalleryImportRunStatus('等待抓取结果');
            return;
        }

        setGalleryImportRunStatus('整理抓取结果...');
        await stageGalleryImportItems(items);
        setGalleryImportRunStatus(galleryImportState.mode === 'stream' ? '准备上传...' : '已生成预览');

        if (galleryImportState.mode === 'stream') {
            await runGalleryImportUploadQueue();
        } else {
            showAdminStudioToast('抓取结果已进入预览队列', 'success');
        }
    } catch (error) {
        console.error('[GalleryImport] Task failed:', error);
        showAdminStudioToast(error.message || '导入任务失败', 'error');
        setGalleryImportRunStatus('任务失败');
    } finally {
        galleryImportState.running = false;
    }
}

async function cleanupGalleryImportItems() {
    const cleanupIds = galleryImportState.items
        .filter((item) => ['imported', 'skipped'].includes(String(item?.status || '')))
        .map((item) => item.id)
        .filter(Boolean);
    if (!cleanupIds.length) {
        showAdminStudioToast('没有需要清理的已处理内容', 'info');
        return;
    }

    try {
        const payload = await mutateGalleryImport('cleanup_items', {
            item_ids: cleanupIds
        });
        (payload.items || []).forEach(upsertGalleryImportItem);
        showAdminStudioToast(`已清理 ${payload.cleanedCount || cleanupIds.length} 条`, 'success');
    } catch (error) {
        showAdminStudioToast(error.message || '清理失败', 'error');
    }
}

async function clearCurrentGalleryImportQueue() {
    if (galleryImportState.running || galleryImportState.uploadInFlight || galleryImportState.statusRefreshInFlight) {
        showAdminStudioToast('当前仍有导入或状态刷新任务，请等待完成后再清空', 'warning');
        return;
    }
    const cleanupIds = galleryImportState.items
        .map((item) => item.id)
        .filter((id) => id && !String(id).startsWith('preview-'));
    if (!cleanupIds.length) {
        showAdminStudioToast('当前队列没有可清空的内容', 'info');
        return;
    }
    if (!confirm(`确定清空当前队列的 ${cleanupIds.length} 条内容吗？已抓取的原始图片和提示词暂存会被清掉。`)) {
        return;
    }

    try {
        const payload = await mutateGalleryImport('cleanup_items', {
            item_ids: cleanupIds
        });
        const cleanedIds = new Set((payload.items || []).map((item) => String(item.id || '')).filter(Boolean));
        galleryImportState.items = galleryImportState.items.filter((item) => !cleanedIds.has(String(item.id || '')));
        galleryImportState.batch = null;
        const rawInput = document.getElementById('galleryImportRawInput');
        if (rawInput) rawInput.value = '';
        setGalleryImportEmptyMessage('当前队列已清空，可以开始新的采集任务。');
        renderGalleryImportQueue(galleryImportState.items);
        setGalleryImportRunStatus('当前队列已清空');
        showAdminStudioToast(`已清空 ${payload.cleanedCount || cleanupIds.length} 条`, 'success');
    } catch (error) {
        showAdminStudioToast(error.message || '清空队列失败', 'error');
    }
}

function handleGalleryImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const previewItems = loadGalleryImportRawText(String(reader.result || ''), '已读取');
        if (previewItems.length) {
            showAdminStudioToast(`已读取 ${previewItems.length} 条，点开始任务写入队列`, 'success');
        }
    };
    reader.onerror = () => {
        showAdminStudioToast('读取抓取结果失败', 'error');
    };
    reader.readAsText(file);
}

async function pasteGalleryImportClipboard() {
    if (!navigator.clipboard?.readText) {
        showAdminStudioToast('浏览器不允许直接读取剪贴板，请展开高级导入文本后手动粘贴', 'warning');
        setGalleryImportRunStatus('请手动粘贴结果');
        return;
    }

    try {
        const text = await navigator.clipboard.readText();
        const previewItems = loadGalleryImportRawText(text, '已从剪贴板读取');
        if (previewItems.length) {
            showAdminStudioToast(`已读取 ${previewItems.length} 条，点开始任务写入队列`, 'success');
        } else {
            showAdminStudioToast('剪贴板里没有采集结果', 'warning');
        }
    } catch (error) {
        console.warn('[GalleryImport] Clipboard read failed:', error);
        showAdminStudioToast('读取剪贴板失败，请展开高级导入文本后手动粘贴', 'warning');
        setGalleryImportRunStatus('请手动粘贴结果');
    }
}

function initGalleryImportAssistant() {
    initCustomDropdown?.();

    let savedParallelism = GALLERY_IMPORT_DEFAULT_PARALLELISM;
    try {
        savedParallelism = normalizeGalleryImportNumber(
            localStorage.getItem(GALLERY_IMPORT_PARALLELISM_STORAGE_KEY),
            GALLERY_IMPORT_DEFAULT_PARALLELISM,
            GALLERY_IMPORT_MAX_PARALLELISM
        ) || GALLERY_IMPORT_DEFAULT_PARALLELISM;
    } catch (_) {
        savedParallelism = GALLERY_IMPORT_DEFAULT_PARALLELISM;
    }
    setCustomDropdownValue('galleryImportParallelismDropdown', String(savedParallelism));
    const parallelismInput = document.getElementById('galleryImportParallelism');
    if (parallelismInput && parallelismInput.dataset.galleryImportPersistBound !== '1') {
        parallelismInput.dataset.galleryImportPersistBound = '1';
        parallelismInput.addEventListener('change', () => {
            const value = normalizeGalleryImportNumber(
                parallelismInput.value,
                GALLERY_IMPORT_DEFAULT_PARALLELISM,
                GALLERY_IMPORT_MAX_PARALLELISM
            ) || GALLERY_IMPORT_DEFAULT_PARALLELISM;
            try {
                localStorage.setItem(GALLERY_IMPORT_PARALLELISM_STORAGE_KEY, String(value));
            } catch (_) {
                // Local storage may be unavailable in hardened browser contexts.
            }
        });
    }

    const fileInput = document.getElementById('galleryImportFileInput');
    if (fileInput && fileInput.dataset.bound !== '1') {
        fileInput.dataset.bound = '1';
        fileInput.addEventListener('change', (event) => {
            handleGalleryImportFile(event.target.files?.[0]);
            event.target.value = '';
        });
    }

    const rawInput = document.getElementById('galleryImportRawInput');
    if (rawInput && rawInput.dataset.bound !== '1') {
        rawInput.dataset.bound = '1';
        rawInput.addEventListener('input', () => {
            loadGalleryImportRawText(rawInput.value, '已读取');
        });
    }

    const autoDetectToggle = document.getElementById('galleryImportAutoDetectQueue');
    if (autoDetectToggle && autoDetectToggle.dataset.bound !== '1') {
        autoDetectToggle.dataset.bound = '1';
        autoDetectToggle.addEventListener('change', () => {
            const enabled = Boolean(autoDetectToggle.checked);
            setGalleryImportAutoDetectionEnabled(enabled);
            setGalleryImportRunStatus(enabled ? '自动检测队列已开启' : '自动检测已关闭，请手动刷新队列');
        });
    }

    const batchSelect = document.getElementById('galleryImportBatchSelect');
    if (batchSelect && batchSelect.dataset.bound !== '1') {
        batchSelect.dataset.bound = '1';
        batchSelect.addEventListener('change', () => {
            const batchId = String(batchSelect.value || '').trim();
            if (!batchId) return;
            galleryImportState.selectedBatchId = batchId;
            galleryImportState.batchSelectionLocked = true;
            galleryImportState.localPreviewLocked = false;
            void loadGalleryImportBatchById(batchId).catch((error) => {
                setGalleryImportRunStatus('批次读取失败');
                showAdminStudioToast(error.message || '批次读取失败', 'error');
            });
        });
    }
    let autoDetectionEnabled = false;
    try {
        autoDetectionEnabled = localStorage.getItem(GALLERY_IMPORT_AUTO_DETECT_STORAGE_KEY) === '1';
    } catch (_) {
        autoDetectionEnabled = false;
    }
    setGalleryImportAutoDetectionEnabled(autoDetectionEnabled, {
        persist: false,
        runImmediately: autoDetectionEnabled
    });

    setGalleryImportMode(galleryImportState.mode);
    updateGalleryImportProgress();
}

document.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-admin-action]');
    const action = actionEl?.dataset?.adminAction || '';
    if (!action || !action.startsWith('gallery-import-')) return;

    switch (action) {
        case 'gallery-import-open-source':
            window.open(GALLERY_IMPORT_SOURCE_URL, '_blank', 'noopener,noreferrer');
            setGalleryImportRunStatus('已打开 Meigen');
            break;
        case 'gallery-import-copy-collector':
            void copyGalleryImportCollector();
            break;
        case 'gallery-import-pick-file':
            document.getElementById('galleryImportFileInput')?.click();
            break;
        case 'gallery-import-paste-clipboard':
            void pasteGalleryImportClipboard();
            break;
        case 'gallery-import-set-mode':
            setGalleryImportMode(actionEl.dataset.importMode || 'crawl_only');
            break;
        case 'gallery-import-start':
            void startGalleryImportTask();
            break;
        case 'gallery-import-upload-staged':
            void runGalleryImportUploadQueue();
            break;
        case 'gallery-import-refresh':
            void loadLatestGalleryImportBatch().catch((error) => {
                showAdminStudioToast(error.message || '刷新队列失败', 'error');
            });
            break;
        case 'gallery-import-refresh-status':
            void refreshGalleryImportProcessingStatus().catch((error) => {
                setGalleryImportRunStatus('刷新处理状态失败');
                showAdminStudioToast(error.message || '刷新处理状态失败', 'error');
            });
            break;
        case 'gallery-import-cleanup':
            void cleanupGalleryImportItems();
            break;
        case 'gallery-import-clear-current':
            void clearCurrentGalleryImportQueue();
            break;
    }
});

initGalleryImportAssistant();

// ========================================
// IMAGE PREVIEW & CROP
// ========================================
let hoveredPreviewItem = null;

function handleImageKeydown(e) {
    const focusedPreviewItem = document.activeElement instanceof Element
        ? document.activeElement.closest('.preview-item')
        : null;
    const activePreviewItem = focusedPreviewItem || hoveredPreviewItem;
    const actionTarget = e.target instanceof Element
        ? e.target.closest('.preview-action-btn, .remove-btn')
        : null;

    // Spacebar / Enter for preview when hovering or focusing preview items
    if ((e.code === 'Space' || e.code === 'Enter') && activePreviewItem && !actionTarget) {
        e.preventDefault();
        openLightbox(activePreviewItem.querySelector('img')?.src);
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

async function openCropModal(index) {
    cropImageIndex = index;
    const file = uploadedFiles[index];
    if (!file?.dataUrl) {
        showAdminStudioToast('图片仍在加载中，请稍后再试', 'warning');
        return;
    }

    const cropImage = document.getElementById('cropImage');
    cropImage.src = file.dataUrl;
    showAdminStudioOverlay(document.getElementById('cropModalOverlay'));

    if (typeof window.ensureAdminCropper === 'function') {
        try {
            await window.ensureAdminCropper();
        } catch (error) {
            console.error('Failed to load Cropper runtime:', error);
            closeCropModal();
            showAdminStudioToast('裁切工具加载失败，请稍后重试', 'error');
            return;
        }
    }

    if (typeof Cropper === 'undefined') {
        closeCropModal();
        showAdminStudioToast('裁切工具暂不可用，请稍后重试', 'error');
        return;
    }

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
        showAdminStudioToast('请先选择裁切区域', 'error');
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
            showAdminStudioToast('裁切失败，请重试', 'error');
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

        showAdminStudioToast('裁切成功！', 'success');
        closeCropModal();

    } catch (err) {
        console.error('Crop error:', err);
        showAdminStudioToast('裁切失败: ' + err.message, 'error');
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

// Attach click-to-preview on preview items
document.addEventListener('click', (e) => {
    const previewItem = e.target.closest('.preview-item');
    if (previewItem && !e.target.closest('.remove-btn') && !e.target.closest('.preview-action-btn')) {
        openLightbox(previewItem.querySelector('img')?.src);
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
        if (p.source_url) addToIndex(p.source_url);
        if (p.source_author_name) addToIndex(p.source_author_name);
        if (p.source_author_handle) addToIndex(p.source_author_handle);
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
                p.source_url || '',
                p.source_author_name || '',
                p.source_author_handle || '',
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
            },
            budget: {
                tier: 'lean',
                maxInputChars: 4000,
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
 * Main search function.
 * Manage view search is server-side so pagination can fetch one page at a time.
 */
async function filterBySearch(query) {
    const queryLower = String(query || '').trim().toLowerCase();
    adminGalleryViewState.searchQuery = queryLower;
    adminGalleryViewState.searchMatchedIds = null;
    return loadAdminPrompts({
        force: true,
        resetPage: true,
        preferFastRender: true,
        replaceExisting: true
    });
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
                ['objects', 'scenes', 'styles', 'mood'].forEach(source => {
                    const tags = aiTags[source];
                    if (tags?.en) {
                        tags.en.forEach(t => tagFreq[t] = (tagFreq[t] || 0) + 1);
                    }
                });
                [
                    aiTags.useCase?.platform,
                    aiTags.useCase?.purpose,
                    aiTags.useCase?.format,
                    aiTags.commercial?.niche,
                    aiTags.commercial?.targetAudience,
                    aiTags.difficulty ? [aiTags.difficulty] : []
                ].forEach((values) => {
                    if (Array.isArray(values)) {
                        values.forEach((tag) => {
                            const normalized = String(tag || '').trim();
                            if (normalized) {
                                tagFreq[normalized] = (tagFreq[normalized] || 0) + 1;
                            }
                        });
                    }
                });
            }
        });

        HOT_TAGS_CACHE = Object.entries(tagFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
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
        void loadAdminPrompts({
            force: true,
            resetPage: true,
            preferFastRender: true,
            replaceExisting: true
        });
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

async function bootAdminStudio() {
    window.AdminStudioTiming?.mark?.('studio:boot:start', {
        readyState: document.readyState
    });
    try {
        const access = await requireAdminStudioAccess();
        if (!access) return;
        await initializeAdminStudioShell();
        window.AdminStudioTiming?.mark?.('studio:boot:ready', {
            isAdmin: window.isAdmin === true
        });
    } catch (error) {
        window.AdminStudioTiming?.mark?.('studio:boot:error', {
            message: error?.message || 'unknown'
        });
        console.error('[AdminStudio] Failed to boot Admin Studio:', error);
        window.adminStudioAccessGranted = false;
        renderAdminStudioAccessGate('denied', {
            title: '后台初始化失败',
            message: '后台启动时发生异常，页面已停止等待以避免一直卡在加载状态。请刷新重试；如果仍然出现，请回到首页重新进入后台。',
            primaryLabel: '刷新重试',
            primaryHref: 'admin-studio.html',
            secondaryLabel: '返回首页',
            secondaryHref: 'index.html'
        });
    }
}

function scheduleAdminStudioBoot() {
    window.AdminStudioTiming?.mark?.('studio:boot:scheduled', {
        readyState: document.readyState
    });
    window.setTimeout(() => {
        void bootAdminStudio();
    }, 0);
}

window.__adminStudioRuntimeReady = true;
bindAdminStudioDelegatedControls();
initAdminStudioLargeModalCloseEnhancer();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAdminStudioBoot, { once: true });
} else {
    scheduleAdminStudioBoot();
}
