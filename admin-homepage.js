/**
 * Homepage Content Management Module
 * 主页内容管理 - Admin Studio
 */

const HomepageAdmin = (() => {
    // ============================================
    // STATE
    // ============================================
    let configCache = {};  // { section: { id, content, is_visible, display_order, updated_at } }
    let configCacheBySite = { cn: {}, intl: {} };
    let currentSection = 'hero';
    let currentReadSite = 'all';
    let initialized = false;
    let loadingPromise = null;
    let loadingSite = '';

    const SV_LABELS = {
        hero: { icon: 'fas fa-image', label: 'Hero 横幅' },
        gallery: { icon: 'fas fa-palette', label: '提示词图库' },
        shop: { icon: 'fas fa-store', label: '资源商城' },
        verify: { icon: 'fas fa-shield-alt', label: 'API 验证' },
        guestbook: { icon: 'fas fa-comment-dots', label: '留言板' },
        footer: { icon: 'fas fa-columns', label: '页脚链接' }
    };
    const VIS_TO_SECTION = { hero: 'hero', gallery: 'prompts', shop: 'shop', verify: 'verify', guestbook: 'guestbook', footer: 'footer' };
    const HOMEPAGE_ADMIN_HIDDEN_CLASS = 'admin-studio-inline-style-attr-3';
    const HOMEPAGE_ADMIN_PREVIEW_HIDDEN_CLASS = 'admin-studio-inline-style-attr-149';
    const HOMEPAGE_PREFETCH_CACHE_KEY = 'homepage_prefetch';
    const HOMEPAGE_CONFIG_LAST_UPDATED_KEY = 'homepage_config_last_updated_at';
    const HOMEPAGE_MANAGED_SECTIONS = ['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker', 'footer'];

    function normalizeHomepageSite(site) {
        if (site === 'intl') return 'intl';
        if (site === 'all') return 'all';
        return 'cn';
    }

    function getHomepageReadSite() {
        const filter = window.AdminSiteFilter?.getSiteFilter?.() || 'all';
        return normalizeHomepageSite(filter);
    }

    function isHomepageAggregateMode(site = currentReadSite || getHomepageReadSite()) {
        return normalizeHomepageSite(site) === 'all';
    }

    function getHomepageSiteLabel(site) {
        const normalized = normalizeHomepageSite(site);
        if (normalized === 'intl') return 'INTL 站';
        if (normalized === 'all') return '全部站点';
        return 'CN 站';
    }

    function getHomepagePrefetchCacheKey(site = getHomepageReadSite()) {
        return `${HOMEPAGE_PREFETCH_CACHE_KEY}_${normalizeHomepageSite(site)}`;
    }

    function getHomepageConfigLastUpdatedKey(site = getHomepageReadSite()) {
        return `${HOMEPAGE_CONFIG_LAST_UPDATED_KEY}_${normalizeHomepageSite(site)}`;
    }

    async function parseHomepageAdminResponse(response) {
        let payload = {};
        try {
            payload = await response.json();
        } catch (error) {
            payload = {};
        }

        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || `Homepage request failed (${response.status})`);
        }

        return payload;
    }

    function escapeHomepageHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function fetchHomepageConfigRows(site = getHomepageReadSite()) {
        const response = await (window.AdminApi?.fetch || fetch)(
            `/api/admin/homepage/config?site=${encodeURIComponent(normalizeHomepageSite(site))}`,
            {
                credentials: 'include'
            }
        );

        return parseHomepageAdminResponse(response);
    }

    function buildHomepageConfigRecord(row = {}) {
        return {
            id: row.id || null,
            site: normalizeHomepageSite(row.site),
            content: row.content && typeof row.content === 'object' && !Array.isArray(row.content)
                ? row.content
                : {},
            is_visible: row.is_visible !== false,
            display_order: Number(row.display_order ?? 0) || 0,
            updated_at: row.updated_at || null
        };
    }

    function buildEmptyHomepageSectionContent(section) {
        switch (section) {
            case 'hero':
                return { title: '', subtitle: '', enable_auto: false };
            case 'prompts':
                return { section_title: '', section_subtitle: '', max_items: '', sort: '', enable_auto: false, featured_items: [] };
            case 'shop':
                return { section_title: '', section_subtitle: '', max_items: '', category: '', sort: '', enable_auto: false };
            case 'verify':
                return { section_title: '', section_subtitle: '', screenshot_path: '', features: [], enable_auto: false };
            case 'guestbook':
                return { section_title: '', section_subtitle: '', max_items: '', enable_auto: false };
            case 'ticker':
                return { speed: 30, shop_scroll_speed: 30, enable_prompts: false, enable_products: false, enable_auto: false };
            default:
                return { enable_auto: false };
        }
    }

    function getLatestHomepageUpdatedAt(values = []) {
        return (Array.isArray(values) ? values : [])
            .map((value) => ({ value, timestamp: Date.parse(value) }))
            .filter((item) => item.value && Number.isFinite(item.timestamp))
            .sort((left, right) => right.timestamp - left.timestamp)[0]?.value || null;
    }

    function buildAggregateHomepageConfigCache(groupedCache = {}) {
        const aggregateCache = {};

        HOMEPAGE_MANAGED_SECTIONS.forEach((section) => {
            const cnConfig = groupedCache.cn?.[section] || null;
            const intlConfig = groupedCache.intl?.[section] || null;
            aggregateCache[section] = {
                id: null,
                site: 'all',
                content: buildEmptyHomepageSectionContent(section),
                is_visible: cnConfig?.is_visible !== false || intlConfig?.is_visible !== false,
                display_order: Number(cnConfig?.display_order ?? intlConfig?.display_order ?? 0) || 0,
                updated_at: getLatestHomepageUpdatedAt([cnConfig?.updated_at, intlConfig?.updated_at])
            };
        });

        return aggregateCache;
    }

    function getHomepageSectionConfigBySite(section, site) {
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return configCache[section] || null;
        }
        return configCacheBySite[normalizedSite]?.[section] || null;
    }

    function formatHomepageSummaryValue(value, fallback = '未配置') {
        if (Array.isArray(value)) {
            return value.length ? escapeHomepageHtml(value.join('、')) : fallback;
        }
        const normalized = String(value ?? '').trim();
        return normalized ? escapeHomepageHtml(normalized) : fallback;
    }

    function normalizeHomepageFeaturedPromptItems(value) {
        if (!Array.isArray(value)) {
            return [];
        }

        return value
            .map((item) => {
                if (!item || typeof item !== 'object') {
                    return null;
                }

                const id = String(item.id || '').trim();
                if (!id) {
                    return null;
                }

                return {
                    id,
                    title: String(item.title || '').trim(),
                    title_zh: String(item.title_zh || '').trim(),
                    title_en: String(item.title_en || '').trim(),
                    image: String(item.image || item.image_url || '').trim(),
                    tags: Array.isArray(item.tags)
                        ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
                        : []
                };
            })
            .filter(Boolean);
    }

    function buildHomepageFeaturedPromptItem(prompt = {}) {
        const images = Array.isArray(prompt.images) ? prompt.images : [];
        return {
            id: String(prompt.id || '').trim(),
            title: String(prompt.title || '').trim(),
            title_zh: String(prompt.title_zh || '').trim(),
            title_en: String(prompt.title_en || '').trim(),
            image: String(images[0] || '').trim(),
            tags: Array.isArray(prompt.tags)
                ? prompt.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
                : []
        };
    }

    function getHomepageFeaturedPromptLabel(item = {}) {
        return String(item.title || item.title_zh || item.title_en || item.id || '').trim() || '未命名 Prompt';
    }

    function getHomepageFeaturedPromptItemsForSite(site = getHomepageReadSite()) {
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return [];
        }

        const promptsConfig = getHomepageSectionConfigBySite('prompts', normalizedSite);
        return normalizeHomepageFeaturedPromptItems(promptsConfig?.content?.featured_items);
    }

    function getHomepageFeaturedPromptSites(promptId = '') {
        const normalizedPromptId = String(promptId || '').trim();
        if (!normalizedPromptId) {
            return [];
        }

        return ['cn', 'intl'].filter((site) => (
            getHomepageFeaturedPromptItemsForSite(site).some((item) => item.id === normalizedPromptId)
        ));
    }

    function isPromptFeatured(promptId = '', options = {}) {
        const normalizedPromptId = String(promptId || '').trim();
        if (!normalizedPromptId) {
            return false;
        }

        const normalizedSite = normalizeHomepageSite(options.site || getHomepageReadSite());
        if (normalizedSite === 'all') {
            return getHomepageFeaturedPromptSites(normalizedPromptId).length > 0;
        }

        return getHomepageFeaturedPromptItemsForSite(normalizedSite).some((item) => item.id === normalizedPromptId);
    }

    function getHomepageAdminRouteUrlObject() {
        if (typeof window.getAdminStudioUrlObject === 'function') {
            const resolvedUrl = window.getAdminStudioUrlObject();
            if (resolvedUrl) {
                return resolvedUrl;
            }
        }

        try {
            return new URL(window.location.href);
        } catch (error) {
            console.warn('[Homepage] Failed to parse current URL:', error);
            return null;
        }
    }

    function getHomepageAdminRouteState() {
        const url = getHomepageAdminRouteUrlObject();
        const searchParams = url?.searchParams;
        const requestedSection = String(searchParams?.get('homepage_section') || '').trim().toLowerCase();
        return {
            section: HOMEPAGE_MANAGED_SECTIONS.includes(requestedSection) ? requestedSection : currentSection,
            focusPromptId: String(searchParams?.get('homepage_prompt_id') || '').trim()
        };
    }

    function syncHomepageAdminRouteState(nextState = {}, options = {}) {
        const url = getHomepageAdminRouteUrlObject();
        if (!url || typeof window.history?.replaceState !== 'function') {
            return false;
        }

        const currentState = getHomepageAdminRouteState();
        const section = String(nextState.section || currentState.section || currentSection || 'hero').trim().toLowerCase();
        const focusPromptId = Object.prototype.hasOwnProperty.call(nextState, 'focusPromptId')
            ? String(nextState.focusPromptId || '').trim()
            : currentState.focusPromptId;

        if (options.ensureHomepageModule === true) {
            url.searchParams.set('module', 'homepage');
        }

        url.searchParams.set('homepage_section', section);
        if (focusPromptId) {
            url.searchParams.set('homepage_prompt_id', focusPromptId);
        } else {
            url.searchParams.delete('homepage_prompt_id');
        }

        const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
        const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextRelativeUrl !== currentRelativeUrl) {
            window.history.replaceState(window.history.state, '', nextRelativeUrl);
        }
        return true;
    }

    function buildHomepageSectionSummaryLines(section, cfg = null) {
        const content = cfg?.content || {};

        if (!cfg) {
            return [{ label: '状态', value: '未配置' }];
        }

        switch (section) {
            case 'hero':
                return [
                    { label: '标题', value: formatHomepageSummaryValue(content.title) },
                    { label: '副标题', value: formatHomepageSummaryValue(content.subtitle) }
                ];
            case 'prompts':
                return [
                    { label: '标题', value: formatHomepageSummaryValue(content.section_title) },
                    { label: '副标题', value: formatHomepageSummaryValue(content.section_subtitle) },
                    { label: '数量', value: formatHomepageSummaryValue(content.max_items, '默认') },
                    {
                        label: '模式',
                        value: content.enable_auto === false ? '手动精选' : '自动聚合'
                    },
                    {
                        label: '精选',
                        value: formatHomepageSummaryValue(
                            normalizeHomepageFeaturedPromptItems(content.featured_items).length,
                            '0'
                        )
                    }
                ];
            case 'shop':
                return [
                    { label: '标题', value: formatHomepageSummaryValue(content.section_title) },
                    { label: '副标题', value: formatHomepageSummaryValue(content.section_subtitle) },
                    { label: '分类', value: formatHomepageSummaryValue(content.category, '全部分类') }
                ];
            case 'verify':
                return [
                    { label: '标题', value: formatHomepageSummaryValue(content.section_title) },
                    { label: '副标题', value: formatHomepageSummaryValue(content.section_subtitle) },
                    { label: '截图', value: content.screenshot_path ? '已配置' : '未配置' }
                ];
            case 'guestbook':
                return [
                    { label: '标题', value: formatHomepageSummaryValue(content.section_title) },
                    { label: '副标题', value: formatHomepageSummaryValue(content.section_subtitle) },
                    { label: '数量', value: formatHomepageSummaryValue(content.max_items, '默认') }
                ];
            case 'ticker':
                return [
                    { label: '提示词速度', value: formatHomepageSummaryValue(content.speed, '30') },
                    { label: '商城速度', value: formatHomepageSummaryValue(content.shop_scroll_speed, '30') },
                    { label: '内容源', value: `${content.enable_prompts ? '提示词' : '提示词关闭'} / ${content.enable_products ? '商城' : '商城关闭'}` }
                ];
            default:
                return [{ label: '状态', value: '已加载' }];
        }
    }

    function renderHomepageReadModeBanner() {
        const bannerId = 'hp-read-mode-banner';
        const bannerClassName = 'hp-readonly-banner';
        const existingBanner = document.getElementById(bannerId);
        if (!existingBanner) {
            return;
        }

        existingBanner.id = bannerId;
        existingBanner.classList.add(bannerClassName);
        existingBanner.hidden = true;
        existingBanner.setAttribute('aria-hidden', 'true');
        existingBanner.remove();
    }

    async function updateHomepageConfigRow({
        id,
        section,
        site,
        content,
        is_visible,
        display_order
    }) {
        const response = await (window.AdminApi?.fetch || fetch)('/api/admin/homepage/config', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id,
                section,
                site: normalizeHomepageSite(site),
                content,
                is_visible,
                display_order
            })
        });

        return parseHomepageAdminResponse(response);
    }

    function setHomepageAdminHiddenState(target, hidden, hiddenClass = HOMEPAGE_ADMIN_HIDDEN_CLASS) {
        if (!target) return;
        if (hiddenClass) {
            target.classList.toggle(hiddenClass, !!hidden);
            return;
        }
        target.hidden = !!hidden;
    }

    function showHomepageSaveIndicator(indicator, durationMs = 2000) {
        if (!indicator) return;
        indicator.classList.add('visible');
        clearTimeout(indicator._homepageSaveTimer);
        indicator._homepageSaveTimer = setTimeout(() => {
            indicator.classList.remove('visible');
        }, durationMs);
    }

    function setHomepageSectionViewState(view, isActive) {
        if (!view) return;
        view.classList.toggle('active', !!isActive);
        view.hidden = !isActive;
    }

    function setHomepagePreviewState(previewImg, placeholder, hasPreview) {
        if (previewImg) {
            previewImg.classList.toggle(HOMEPAGE_ADMIN_PREVIEW_HIDDEN_CLASS, !hasPreview);
        }
        if (placeholder) {
            placeholder.hidden = !!hasPreview;
        }
    }

    function invalidateHomepageRuntimeCaches(site = getHomepageReadSite()) {
        const safeSite = normalizeHomepageSite(site);
        try {
            localStorage.removeItem(`zaoyoe_${safeSite}_cache_v1_homepage_config`);
            localStorage.removeItem('zaoyoe_cache_v1_homepage_config');
            localStorage.setItem(getHomepageConfigLastUpdatedKey(safeSite), String(Date.now()));
            localStorage.removeItem(HOMEPAGE_CONFIG_LAST_UPDATED_KEY);
            console.log('[Homepage] Invalidated homepage_config cache');
        } catch (e) {
            console.warn('[Homepage] Failed to invalidate local cache:', e);
        }

        try {
            sessionStorage.removeItem(getHomepagePrefetchCacheKey(safeSite));
            sessionStorage.removeItem(HOMEPAGE_PREFETCH_CACHE_KEY);
        } catch (e) {
            console.warn('[Homepage] Failed to invalidate homepage prefetch cache:', e);
        }
    }

    function invalidateSectionVisibilityCaches() {
        try {
            ['cn', 'intl'].forEach(site => {
                localStorage.removeItem(`zaoyoe_section_vis_${site}`);
            });
        } catch (e) {
            console.warn('[Homepage] Failed to invalidate section visibility cache:', e);
        }
    }

    function renderHomepageLoadingError(loading, message) {
        if (!loading) return;
        loading.innerHTML = `
            <i class="fas fa-exclamation-triangle hp-loading-error-icon"></i>
            <div>加载失败: ${message}</div>
            <button class="btn-sm btn-primary js-homepage-retry-btn hp-loading-retry-btn" data-homepage-retry="1">
                <i class="fas fa-redo"></i> 重试
            </button>
        `;
        loading.querySelector('[data-homepage-retry="1"]')?.addEventListener('click', () => {
            init();
        });
    }

    function renderHomepageLoadingSkeleton(loading) {
        if (!loading) return;
        loading.innerHTML = `
            <div class="hp-loading-shell" aria-hidden="true">
                <div class="hp-loading-shell__intro">
                    <div class="hp-loading-shell__copy">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                    </div>
                    <div class="hp-loading-shell__tabs">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                    </div>
                </div>
                <div class="hp-loading-editor">
                    <div class="hp-loading-control-bar">
                        <div class="hp-loading-control hp-loading-control--toggle">
                            <div class="hp-loading-control__copy">
                                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                            </div>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                        </div>
                        <div class="hp-loading-control hp-loading-control--order">
                            <div class="hp-loading-control__copy">
                                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-20"></span>
                                <span class="admin-skeleton-block hp-loading-control__field"></span>
                            </div>
                        </div>
                        <div class="hp-loading-control hp-loading-control--status">
                            <div class="hp-loading-control__copy">
                                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                                <div class="hp-loading-control__status-row">
                                    <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="hp-loading-shell__grid hp-loading-shell__grid--editor">
                        <div class="hp-loading-card hp-loading-card--editor-main">
                            <div class="hp-loading-card__bar hp-loading-card__bar--editor">
                                <div class="hp-loading-card__title-group">
                                    <span class="admin-skeleton-block hp-loading-card__icon"></span>
                                    <div class="hp-loading-card__copy">
                                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-40"></span>
                                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                                    </div>
                                </div>
                                <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                            </div>
                            <div class="hp-loading-form-grid">
                                ${Array.from({ length: 4 }, (_, index) => `
                                    <div class="hp-loading-field${index === 3 ? ' hp-loading-field--wide' : ''}">
                                        <span class="admin-skeleton-block admin-skeleton-block--line ${index === 0 ? 'admin-skeleton-w-30' : index === 1 ? 'admin-skeleton-w-40' : 'admin-skeleton-w-20'}"></span>
                                        <span class="admin-skeleton-block hp-loading-field__input${index === 3 ? ' hp-loading-field__input--tall' : ''}"></span>
                                    </div>
                                `).join('')}
                                <div class="hp-loading-field hp-loading-field--full">
                                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-20"></span>
                                    <div class="hp-loading-slider-row">
                                        <span class="admin-skeleton-block hp-loading-slider-row__track"></span>
                                        <span class="admin-skeleton-block hp-loading-slider-row__value"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="hp-loading-card hp-loading-card--editor-side">
                            <div class="hp-loading-preview">
                                <span class="admin-skeleton-block hp-loading-preview__media"></span>
                                <div class="hp-loading-preview__meta">
                                    <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-50"></span>
                                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-full"></span>
                                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                                    <div class="hp-loading-preview__chips">
                                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                                    </div>
                                </div>
                            </div>
                            <div class="hp-loading-side-note">
                                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-full"></span>
                                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                            </div>
                        </div>
                    </div>
                    <div class="hp-loading-footer">
                        <div class="hp-loading-footer__meta">
                            <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-20"></span>
                        </div>
                        <div class="hp-loading-footer__actions">
                            <span class="admin-skeleton-block hp-loading-footer__action hp-loading-footer__action--secondary"></span>
                            <span class="admin-skeleton-block hp-loading-footer__action"></span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function hasHomepageConfigForSite(site = getHomepageReadSite()) {
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return Object.keys(configCacheBySite.cn || {}).length > 0
                && Object.keys(configCacheBySite.intl || {}).length > 0;
        }

        return Object.keys(configCacheBySite[normalizedSite] || {}).length > 0;
    }

    function applyHomepageConfigForSite(site = getHomepageReadSite()) {
        currentReadSite = normalizeHomepageSite(site);
        configCache = isHomepageAggregateMode(currentReadSite)
            ? buildAggregateHomepageConfigCache(configCacheBySite)
            : { ...(configCacheBySite[currentReadSite] || {}) };
    }

    async function ensureHomepageConfigLoaded({ force = false } = {}) {
        const targetSite = getHomepageReadSite();
        const normalizedTargetSite = normalizeHomepageSite(targetSite);

        if (!force && hasHomepageConfigForSite(normalizedTargetSite)) {
            applyHomepageConfigForSite(normalizedTargetSite);
            return true;
        }

        if (!force && loadingPromise && loadingSite === normalizedTargetSite) {
            return loadingPromise;
        }

        loadingSite = normalizedTargetSite;
        loadingPromise = Promise.resolve()
            .then(() => loadAllConfig())
            .finally(() => {
                loadingPromise = null;
                loadingSite = '';
            });

        return loadingPromise;
    }

    function requireWritableHomepageSite(options = {}) {
        return window.AdminSiteFilter?.requireWritableSite?.(options) || null;
    }

    // ============================================
    // INIT
    // ============================================

    async function init() {
        const loading = document.getElementById('hp-loading');
        const content = document.getElementById('hp-section-content');
        const routeState = getHomepageAdminRouteState();
        if (routeState.section) {
            currentSection = routeState.section;
        }

        if (initialized) {
            await ensureHomepageConfigLoaded();
            renderAllSections();
            renderCurrentSection();
            return;
        }

        console.log('[Homepage] Initializing homepage config module...');

        try {
            renderHomepageLoadingSkeleton(loading);
            setHomepageAdminHiddenState(loading, false);
            setHomepageAdminHiddenState(content, true);

            await ensureHomepageConfigLoaded();
            setupEventListeners();
            initialized = true;

            // Hide loading, show content
            setHomepageAdminHiddenState(loading, true);
            setHomepageAdminHiddenState(content, false);

            console.log('[Homepage] Initialized successfully');
        } catch (err) {
            console.error('[Homepage] Init error:', err);
            renderHomepageLoadingError(loading, err.message);
        }
    }

    async function prefetch() {
        try {
            await ensureHomepageConfigLoaded();
            return true;
        } catch (error) {
            console.warn('[Homepage] Prefetch failed:', error);
            return false;
        }
    }

    // ============================================
    // DATA LOADING
    // ============================================

    async function loadAllConfig() {
        currentReadSite = getHomepageReadSite();
        const result = await fetchHomepageConfigRows(currentReadSite);
        const rows = Array.isArray(result.rows) ? result.rows : [];
        configCacheBySite = { cn: {}, intl: {} };

        rows.forEach((row) => {
            const section = String(row.section || '').trim().toLowerCase();
            const entry = buildHomepageConfigRecord(row);
            if (!section || entry.site === 'all') {
                return;
            }
            configCacheBySite[entry.site][section] = entry;
        });

        configCache = isHomepageAggregateMode(currentReadSite)
            ? buildAggregateHomepageConfigCache(configCacheBySite)
            : { ...(configCacheBySite[normalizeHomepageSite(currentReadSite)] || {}) };

        console.log('[Homepage] Loaded config for site:', currentReadSite, Object.keys(configCache));

        // Render all sections
        renderAllSections();
    }

    // ============================================
    // RENDER
    // ============================================

    function renderAllSections() {
        ['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker'].forEach(section => {
            renderSection(section);
        });
        renderHomepageReadModeBanner();
        setHomepageEditorReadOnlyState();
        // Render visibility toggles for all sections
        renderAllVisibilityToggles();
        renderHomepageAggregateSummaries();
    }

    function renderCurrentSection() {
        renderSection(currentSection);
    }

    function renderSection(section) {
        const cfg = configCache[section];
        if (!cfg) return;

        const content = cfg.content || {};

        // Common controls
        setToggle(`hp-${section}-visible`, cfg.is_visible);
        setInputValue(`hp-${section}-order`, cfg.display_order);

        // Auto aggregation toggle
        setToggle(`hp-${section}-auto`, content.enable_auto);

        // Updated timestamp
        const updatedEl = document.getElementById(`hp-${section}-updated`);
        if (updatedEl && cfg.updated_at) {
            const date = new Date(cfg.updated_at);
            updatedEl.textContent = `最后更新: ${date.toLocaleString('zh-CN')}`;
        }

        // Section-specific fields
        switch (section) {
            case 'hero':
                setInputValue('hp-hero-title', content.title);
                setInputValue('hp-hero-subtitle', content.subtitle);
                break;

            case 'prompts':
                setInputValue('hp-prompts-title', content.section_title);
                setInputValue('hp-prompts-subtitle', content.section_subtitle);
                setInputValue('hp-prompts-max', content.max_items);
                setSelectValue('hp-prompts-sort', content.sort);
                renderHomepageFeaturedPromptList(getHomepageAdminRouteState().focusPromptId);
                break;

            case 'shop':
                setInputValue('hp-shop-title', content.section_title);
                setInputValue('hp-shop-subtitle', content.section_subtitle);
                setInputValue('hp-shop-max', content.max_items);
                setSelectValue('hp-shop-category', content.category);
                setSelectValue('hp-shop-sort', content.sort);
                break;

            case 'verify':
                setInputValue('hp-verify-title', content.section_title);
                setInputValue('hp-verify-subtitle', content.section_subtitle);
                setInputValue('hp-verify-screenshot', content.screenshot_path);
                setInputValue('hp-verify-features', (content.features || []).join(', '));
                // Show image preview if path exists
                _updateScreenshotPreview(content.screenshot_path);
                break;

            case 'guestbook':
                setInputValue('hp-guestbook-title', content.section_title);
                setInputValue('hp-guestbook-subtitle', content.section_subtitle);
                setInputValue('hp-guestbook-max', content.max_items);
                break;

            case 'ticker':
                setInputValue('hp-ticker-speed', content.speed);
                const speedLabel = document.getElementById('hp-ticker-speed-label');
                if (speedLabel) speedLabel.textContent = content.speed || 30;
                setInputValue('hp-ticker-shop-speed', content.shop_scroll_speed);
                const shopSpeedLabel = document.getElementById('hp-ticker-shop-speed-label');
                if (shopSpeedLabel) shopSpeedLabel.textContent = content.shop_scroll_speed || 30;
                setToggle('hp-ticker-prompts', content.enable_prompts);
                setToggle('hp-ticker-products', content.enable_products);
                break;
        }
    }

    function renderHomepageFeaturedPromptList(focusPromptId = '') {
        const container = document.getElementById('hp-prompts-featured-list');
        if (!container) {
            return;
        }

        if (isHomepageAggregateMode()) {
            const siteGroups = ['cn', 'intl']
                .map((site) => ({
                    site,
                    label: getHomepageSiteLabel(site),
                    items: getHomepageFeaturedPromptItemsForSite(site)
                }))
                .filter((group) => group.items.length > 0);

            if (!siteGroups.length) {
                container.innerHTML = '<div class="hp-featured-empty">当前还没有任何站点配置手动精选 Prompt。</div>';
                return;
            }

            container.innerHTML = siteGroups.map((group) => `
                <section class="hp-featured-site-group">
                    <div class="hp-featured-site-group__head">
                        <strong>${escapeHomepageHtml(group.label)}</strong>
                        <span>${escapeHomepageHtml(String(group.items.length))} 个精选</span>
                    </div>
                    <div class="hp-featured-site-group__list">
                        ${group.items.map((item, index) => {
                            const title = getHomepageFeaturedPromptLabel(item);
                            const thumb = item.image
                                ? `<img class="hp-featured-prompt__thumb" src="${escapeHomepageHtml(item.image)}" alt="${escapeHomepageHtml(title)}" loading="lazy" decoding="async">`
                                : '<div class="hp-featured-prompt__thumb" aria-hidden="true"></div>';
                            const tagLine = Array.isArray(item.tags) && item.tags.length > 0
                                ? item.tags.join(' · ')
                                : `ID ${item.id}`;
                            const encodedTitle = encodeURIComponent(title);

                            return `
                                <div class="hp-featured-prompt ${item.id === focusPromptId ? 'is-focused' : ''}" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}">
                                    <div class="hp-featured-prompt__rank">#${escapeHomepageHtml(String(index + 1))}</div>
                                    ${thumb}
                                    <div class="hp-featured-prompt__meta">
                                        <div class="hp-featured-prompt__title">${escapeHomepageHtml(title)}</div>
                                        <div class="hp-featured-prompt__sub">${escapeHomepageHtml(tagLine)}</div>
                                    </div>
                                    <div class="hp-featured-prompt__actions">
                                        <button class="hp-featured-prompt__jump" type="button" data-admin-action="homepage-open-featured-gallery" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-prompt-title="${escapeHomepageHtml(encodedTitle)}">
                                            Gallery
                                        </button>
                                        <button class="hp-featured-prompt__jump" type="button" data-admin-action="homepage-open-featured-comments" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-prompt-title="${escapeHomepageHtml(encodedTitle)}">
                                            评论
                                        </button>
                                        <button class="hp-featured-prompt__jump" type="button" data-admin-action="homepage-open-featured-analytics" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-prompt-title="${escapeHomepageHtml(encodedTitle)}">
                                            分析
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </section>
            `).join('');
            return;
        }

        const promptsConfig = configCache.prompts || null;
        const items = normalizeHomepageFeaturedPromptItems(promptsConfig?.content?.featured_items);
        if (!items.length) {
            container.innerHTML = '<div class="hp-featured-empty">当前站点还没有手动精选 Prompt。</div>';
            return;
        }

        container.innerHTML = items.map((item) => {
            const title = getHomepageFeaturedPromptLabel(item);
            const thumb = item.image
                ? `<img class="hp-featured-prompt__thumb" src="${escapeHomepageHtml(item.image)}" alt="${escapeHomepageHtml(title)}" loading="lazy" decoding="async">`
                : '<div class="hp-featured-prompt__thumb" aria-hidden="true"></div>';
            const tagLine = Array.isArray(item.tags) && item.tags.length > 0
                ? item.tags.join(' · ')
                : `ID ${item.id}`;
            const encodedTitle = encodeURIComponent(title);
            const index = items.findIndex((entry) => entry.id === item.id);
            const canMoveUp = index > 0;
            const canMoveDown = index < items.length - 1;

            return `
                <div class="hp-featured-prompt ${item.id === focusPromptId ? 'is-focused' : ''}" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}">
                    <div class="hp-featured-prompt__rank">#${escapeHomepageHtml(String(index + 1))}</div>
                    ${thumb}
                    <div class="hp-featured-prompt__meta">
                        <div class="hp-featured-prompt__title">${escapeHomepageHtml(title)}</div>
                        <div class="hp-featured-prompt__sub">${escapeHomepageHtml(tagLine)}</div>
                    </div>
                    <div class="hp-featured-prompt__actions">
                        <div class="hp-featured-prompt__sort">
                            <button class="hp-featured-prompt__sort-btn" type="button" ${canMoveUp ? '' : 'disabled'} data-admin-action="homepage-move-featured-prompt" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-direction="up">
                                上移
                            </button>
                            <button class="hp-featured-prompt__sort-btn" type="button" ${canMoveDown ? '' : 'disabled'} data-admin-action="homepage-move-featured-prompt" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-direction="down">
                                下移
                            </button>
                        </div>
                        <div class="hp-featured-prompt__jump-group">
                            <button class="hp-featured-prompt__jump" type="button" data-admin-action="homepage-open-featured-gallery" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-prompt-title="${escapeHomepageHtml(encodedTitle)}">
                                Gallery
                            </button>
                            <button class="hp-featured-prompt__jump" type="button" data-admin-action="homepage-open-featured-comments" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-prompt-title="${escapeHomepageHtml(encodedTitle)}">
                                评论
                            </button>
                            <button class="hp-featured-prompt__jump" type="button" data-admin-action="homepage-open-featured-analytics" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-prompt-title="${escapeHomepageHtml(encodedTitle)}">
                                分析
                            </button>
                            <button class="hp-featured-prompt__remove" type="button" data-admin-action="homepage-remove-featured-prompt" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}">
                                移除
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function applyHomepageSavedSectionRow(section, savedRow = {}, site = currentReadSite) {
        const normalizedSite = normalizeHomepageSite(savedRow.site || site);
        const normalizedSection = String(savedRow.section || section || '').trim().toLowerCase();
        if (!normalizedSection || normalizedSite === 'all') {
            return;
        }

        const record = buildHomepageConfigRecord(savedRow);
        configCacheBySite[normalizedSite][normalizedSection] = record;
        applyHomepageConfigForSite(getHomepageReadSite());
        if (currentSection === normalizedSection) {
            renderSection(normalizedSection);
        }
        renderAllVisibilityToggles();
        renderHomepageAggregateSummaries();
    }

    // ============================================
    // SAVE
    // ============================================

    async function saveHomepageFeaturedPromptItems(items, { site, successMessage = '首页精选 Prompt 已更新', focusPromptId = '' } = {}) {
        const normalizedSite = normalizeHomepageSite(site);
        const cfg = getHomepageSectionConfigBySite('prompts', normalizedSite);
        if (!cfg?.id) {
            throw new Error(`缺少 ${normalizedSite.toUpperCase()} 站 prompts 区块配置，无法保存首页精选`);
        }

        const content = {
            ...(cfg.content || {}),
            enable_auto: false,
            featured_items: normalizeHomepageFeaturedPromptItems(items)
        };

        const result = await updateHomepageConfigRow({
            id: cfg.id,
            section: 'prompts',
            site: normalizedSite,
            content,
            is_visible: cfg.is_visible,
            display_order: cfg.display_order
        });
        const savedRow = result.row || {};

        applyHomepageSavedSectionRow('prompts', savedRow, normalizedSite);
        invalidateHomepageRuntimeCaches(normalizedSite);
        invalidateSectionVisibilityCaches();
        syncHomepageAdminRouteState({
            section: 'prompts',
            focusPromptId
        });

        if (typeof showToast === 'function') {
            showToast(successMessage, 'success');
        }

        return savedRow;
    }

    async function addFeaturedPrompt(prompt, options = {}) {
        const writableSite = options.site || requireWritableHomepageSite({ label: '加入首页精选 Prompt' });
        if (!writableSite) {
            return false;
        }

        await ensureHomepageConfigLoaded();
        const nextItem = buildHomepageFeaturedPromptItem(prompt);
        if (!nextItem.id) {
            throw new Error('Prompt 缺少有效 id，无法加入首页精选');
        }

        const cfg = getHomepageSectionConfigBySite('prompts', writableSite);
        const existingItems = normalizeHomepageFeaturedPromptItems(cfg?.content?.featured_items);
        const dedupedItems = existingItems.filter((item) => item.id !== nextItem.id);
        const nextItems = [nextItem, ...dedupedItems];

        await saveHomepageFeaturedPromptItems(nextItems, {
            site: writableSite,
            successMessage: '已加入首页精选 Prompt',
            focusPromptId: nextItem.id
        });

        if (options.navigate === true) {
            window.switchModule?.('homepage');
            await init();
            switchSection('prompts');
        }

        return true;
    }

    async function addFeaturedPrompts(prompts = [], options = {}) {
        const writableSite = options.site || requireWritableHomepageSite({ label: '批量加入首页精选 Prompt' });
        if (!writableSite) {
            return false;
        }

        await ensureHomepageConfigLoaded();
        const cfg = getHomepageSectionConfigBySite('prompts', writableSite);
        const existingItems = normalizeHomepageFeaturedPromptItems(cfg?.content?.featured_items);
        const existingById = new Map(
            existingItems.map((item) => [String(item.id || '').trim(), item])
        );
        const orderedIds = [];

        (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
            const nextItem = buildHomepageFeaturedPromptItem(prompt);
            if (!nextItem.id) {
                return;
            }
            existingById.set(nextItem.id, nextItem);
            orderedIds.push(nextItem.id);
        });

        const uniqueOrderedIds = [...new Set(orderedIds)].filter(Boolean);
        if (!uniqueOrderedIds.length) {
            throw new Error('没有可加入首页精选的 Prompt');
        }

        const remainingItems = existingItems.filter((item) => !uniqueOrderedIds.includes(item.id));
        const nextItems = [
            ...uniqueOrderedIds.map((id) => existingById.get(id)).filter(Boolean),
            ...remainingItems.map((item) => existingById.get(item.id)).filter(Boolean)
        ];

        await saveHomepageFeaturedPromptItems(nextItems, {
            site: writableSite,
            successMessage: `已加入 ${uniqueOrderedIds.length} 条首页精选 Prompt`,
            focusPromptId: uniqueOrderedIds[0] || ''
        });

        if (options.navigate === true) {
            window.switchModule?.('homepage');
            await init();
            switchSection('prompts');
        }

        return true;
    }

    async function removeFeaturedPrompt(promptId, options = {}) {
        const writableSite = options.site || requireWritableHomepageSite({ label: '移除首页精选 Prompt' });
        if (!writableSite) {
            return false;
        }

        await ensureHomepageConfigLoaded();
        const cfg = getHomepageSectionConfigBySite('prompts', writableSite);
        const existingItems = normalizeHomepageFeaturedPromptItems(cfg?.content?.featured_items);
        const nextItems = existingItems.filter((item) => item.id !== String(promptId || '').trim());

        await saveHomepageFeaturedPromptItems(nextItems, {
            site: writableSite,
            successMessage: '已移除首页精选 Prompt',
            focusPromptId: ''
        });
        renderHomepageFeaturedPromptList('');
        return true;
    }

    async function moveFeaturedPrompt(promptId, direction, options = {}) {
        const writableSite = options.site || requireWritableHomepageSite({
            label: direction === 'up' ? '上移首页精选 Prompt' : '下移首页精选 Prompt'
        });
        if (!writableSite) {
            return false;
        }

        await ensureHomepageConfigLoaded();
        const cfg = getHomepageSectionConfigBySite('prompts', writableSite);
        const existingItems = normalizeHomepageFeaturedPromptItems(cfg?.content?.featured_items);
        const currentIndex = existingItems.findIndex((item) => item.id === String(promptId || '').trim());
        if (currentIndex === -1) {
            return false;
        }

        const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= existingItems.length) {
            return false;
        }

        const nextItems = [...existingItems];
        const [movedItem] = nextItems.splice(currentIndex, 1);
        nextItems.splice(nextIndex, 0, movedItem);

        await saveHomepageFeaturedPromptItems(nextItems, {
            site: writableSite,
            successMessage: '首页精选 Prompt 顺序已更新',
            focusPromptId: movedItem.id
        });
        renderHomepageFeaturedPromptList(movedItem.id);
        return true;
    }

    async function saveSection(section) {
        const cfg = configCache[section];
        if (!cfg) {
            console.warn('[Homepage] No config found for section:', section);
            return;
        }

        const writableSite = requireWritableHomepageSite({ action: 'homepage-save-section' });
        if (!writableSite) {
            return;
        }

        // Show translating status on save button
        const saveBtn = document.querySelector(`.hp-section-view[data-hp-view="${section}"] .btn-primary`);
        const originalBtnText = saveBtn ? saveBtn.innerHTML : '';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-language"></i> 翻译中...';
        }

        // Collect updated values
        cfg.is_visible = getToggleState(`hp-${section}-visible`);
        cfg.display_order = parseInt(getInputValue(`hp-${section}-order`)) || 0;

        // Update content based on section
        const content = cfg.content || {};
        content.enable_auto = getToggleState(`hp-${section}-auto`);

        switch (section) {
            case 'hero':
                content.title = getInputValue('hp-hero-title');
                content.subtitle = getInputValue('hp-hero-subtitle');
                // Auto-translate bilingual fields
                await autoTranslatePair(content, 'title');
                await autoTranslatePair(content, 'subtitle');
                break;

            case 'prompts':
                content.section_title = getInputValue('hp-prompts-title');
                content.section_subtitle = getInputValue('hp-prompts-subtitle');
                content.max_items = parseInt(getInputValue('hp-prompts-max')) || 6;
                content.sort = getSelectValue('hp-prompts-sort');
                content.featured_items = normalizeHomepageFeaturedPromptItems(content.featured_items);
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'shop':
                content.section_title = getInputValue('hp-shop-title');
                content.section_subtitle = getInputValue('hp-shop-subtitle');
                content.max_items = parseInt(getInputValue('hp-shop-max')) || 8;
                content.category = getSelectValue('hp-shop-category');
                content.sort = getSelectValue('hp-shop-sort');
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'verify':
                content.section_title = getInputValue('hp-verify-title');
                content.section_subtitle = getInputValue('hp-verify-subtitle');
                content.screenshot_path = getInputValue('hp-verify-screenshot');
                const featuresStr = getInputValue('hp-verify-features');
                content.features = featuresStr
                    ? featuresStr.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'guestbook':
                content.section_title = getInputValue('hp-guestbook-title');
                content.section_subtitle = getInputValue('hp-guestbook-subtitle');
                content.max_items = parseInt(getInputValue('hp-guestbook-max')) || 5;
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'ticker':
                content.speed = parseInt(getInputValue('hp-ticker-speed')) || 30;
                content.shop_scroll_speed = parseInt(getInputValue('hp-ticker-shop-speed')) || 30;
                content.enable_prompts = getToggleState('hp-ticker-prompts');
                content.enable_products = getToggleState('hp-ticker-products');
                break;
        }

        cfg.content = content;

        // Save to database
        try {
            if (!cfg.id) {
                throw new Error(`缺少 ${section} 区块配置行，无法保存`);
            }

            const result = await updateHomepageConfigRow({
                id: cfg.id,
                section,
                site: writableSite,
                content,
                is_visible: cfg.is_visible,
                display_order: cfg.display_order
            });
            const savedRow = result.row || {};

            // Update timestamp
            cfg.updated_at = savedRow.updated_at || new Date().toISOString();
            cfg.site = normalizeHomepageSite(savedRow.site || writableSite);
            cfg.is_visible = savedRow.is_visible !== false;
            cfg.display_order = Number(savedRow.display_order ?? cfg.display_order) || 0;
            cfg.content = savedRow.content || content;
            const updatedEl = document.getElementById(`hp-${section}-updated`);
            if (updatedEl) {
                updatedEl.textContent = `最后更新: ${new Date().toLocaleString('zh-CN')}`;
            }

            // Show save indicator
            const indicator = document.getElementById(`hp-${section}-save-indicator`);
            if (indicator) {
                showHomepageSaveIndicator(indicator, 2000);
            }

            invalidateHomepageRuntimeCaches(writableSite);
            invalidateSectionVisibilityCaches();
            renderAllVisibilityToggles();

            if (typeof showToast === 'function') {
                showToast('保存成功', 'success');
            }

            console.log(`[Homepage] Section "${section}" saved successfully`);
        } catch (err) {
            console.error(`[Homepage] Save error for "${section}":`, err);
            if (typeof showToast === 'function') {
                showToast('保存失败: ' + err.message, 'error');
            }
        } finally {
            // Restore save button
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText;
            }
        }
    }

    // ============================================
    // TAB SWITCHING
    // ============================================

    function switchSection(section) {
        currentSection = section;
        renderSection(section);
        syncHomepageAdminRouteState({
            section,
            focusPromptId: section === 'prompts' ? getHomepageAdminRouteState().focusPromptId : ''
        }, {
            ensureHomepageModule: true
        });

        // Update tab active state
        const tabNav = document.getElementById('homepageTabsNav');
        if (tabNav) {
            tabNav.querySelectorAll('.admin-tab').forEach(tab => {
                tab.classList.toggle('active', tab.getAttribute('data-hp-section') === section);
            });

            // Move tab indicator
            const activeTab = tabNav.querySelector(`.admin-tab[data-hp-section="${section}"]`);
            if (activeTab && typeof window.updateAdminTabIndicator === 'function') {
                window.updateAdminTabIndicator(activeTab);
            }
        }

        // Show/hide section views
        document.querySelectorAll('.hp-section-view').forEach(view => {
            const isActive = view.getAttribute('data-hp-view') === section;
            setHomepageSectionViewState(view, isActive);
        });
    }

    async function openPromptSectionContext(promptId = '', options = {}) {
        const normalizedPromptId = String(promptId || '').trim();

        if (options.ensureModule === true) {
            window.switchModule?.('homepage');
        }

        await init();
        syncHomepageAdminRouteState({
            section: 'prompts',
            focusPromptId: normalizedPromptId
        }, {
            ensureHomepageModule: options.ensureModule === true
        });
        switchSection('prompts');
        renderHomepageFeaturedPromptList(normalizedPromptId);
        return true;
    }

    // ============================================
    // AUTO-TRANSLATE HELPER
    // ============================================

    /**
     * Auto-translate a field to its bilingual counterpart.
     * If base field is Chinese → generates field_en
     * If base field is English → generates field_zh
     * Uses PromptTranslator (Gemini API). Fails silently if no API key.
     *
     * @param {Object} content - The content object to mutate
     * @param {String} fieldName - Base field name (e.g. 'title', 'section_title')
     */
    async function autoTranslatePair(content, fieldName) {
        const text = content[fieldName];
        if (!text || !window.PromptTranslator) return;

        try {
            const isChinese = /[\u4e00-\u9fff]/.test(text);
            if (isChinese) {
                // Chinese → English
                const en = await window.PromptTranslator.translateToEnglish(text);
                if (en) {
                    content[`${fieldName}_en`] = en;
                    console.log(`[Homepage] Translated ${fieldName}: "${text}" → EN: "${en}"`);
                }
            } else {
                // English → Chinese
                const zh = await window.PromptTranslator.translateToChinese(text);
                if (zh) {
                    content[`${fieldName}_zh`] = zh;
                    console.log(`[Homepage] Translated ${fieldName}: "${text}" → ZH: "${zh}"`);
                }
            }
        } catch (err) {
            console.warn(`[Homepage] Translation failed for ${fieldName}:`, err);
            // Non-blocking: save proceeds without translation
        }
    }

    // ============================================
    // TOGGLE HELPERS
    // ============================================

    function toggleVisible(section) {
        if (isHomepageAggregateMode()) return;
        const toggleEl = document.getElementById(`hp-${section}-visible`);
        if (!toggleEl) return;
        const isActive = toggleEl.classList.toggle('active');
        // Visual feedback only — actual save happens when "保存修改" is clicked
    }

    function toggleField(section, field) {
        if (isHomepageAggregateMode()) return;
        const mapping = {
            'enable_auto': `hp-${section}-auto`,
            'enable_prompts': `hp-${section}-prompts`,
            'enable_products': `hp-${section}-products`
        };
        const toggleEl = document.getElementById(mapping[field]);
        if (!toggleEl) return;
        toggleEl.classList.toggle('active');
    }

    // ============================================
    // DOM HELPERS
    // ============================================

    function setToggle(id, value) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', !!value);
    }

    function getToggleState(id) {
        const el = document.getElementById(id);
        return el ? el.classList.contains('active') : false;
    }

    function setInputValue(id, value) {
        const el = document.getElementById(id);
        if (el) {
            el.value = value ?? '';
        }
    }

    function getInputValue(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function setSelectValue(id, value) {
        const el = document.getElementById(id);
        if (el) {
            el.value = value ?? '';
            window.ShopAdmin?.scheduleShopCustomSelectSync?.(el);
        }
    }

    function getSelectValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    // ============================================
    // SECTION VISIBILITY
    // ============================================

    function getAdminSite() {
        return getHomepageReadSite();
    }

    function setHomepageEditorReadOnlyState() {
        const readOnly = isHomepageAggregateMode();

        document.querySelectorAll('#module-homepage .hp-section-view').forEach((view) => {
            view.classList.toggle('hp-section-view--readonly', readOnly);

            view.querySelectorAll('.config-input, textarea, select').forEach((field) => {
                if ('disabled' in field) {
                    field.disabled = readOnly;
                }
                if ('readOnly' in field && field.tagName !== 'SELECT') {
                    field.readOnly = readOnly;
                }
            });

            view.querySelectorAll('[data-admin-action="homepage-save-section"], [data-admin-action="homepage-upload-screenshot"]').forEach((button) => {
                if ('disabled' in button) {
                    button.disabled = readOnly;
                }
                if (readOnly) {
                    button.setAttribute('title', '全部站点视图仅支持查看，请切换到 CN 或 INTL 后编辑');
                } else {
                    button.removeAttribute('title');
                }
            });

            view.querySelectorAll('.status-toggle').forEach((toggle) => {
                toggle.classList.toggle('is-disabled', readOnly);
                toggle.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
            });
        });
    }

    function buildHomepageAggregateVisibilityRows(section) {
        return ['cn', 'intl'].map((site) => {
            const cfg = getHomepageSectionConfigBySite(section, site);
            const isVisible = cfg?.is_visible !== false;
            return `
                <div class="hp-aggregate-visibility-row">
                    <span class="hp-aggregate-visibility-site">${escapeHomepageHtml(getHomepageSiteLabel(site))}</span>
                    <span class="status-badge ${isVisible ? 'active' : 'banned'}">${isVisible ? '已显示' : '已隐藏'}</span>
                </div>
            `;
        }).join('');
    }

    function renderHomepageAggregateVisibilityToggles() {
        const sectionMap = {
            hero: 'hero',
            prompts: 'gallery',
            shop: 'shop',
            verify: 'verify',
            guestbook: 'guestbook'
        };

        Object.entries(sectionMap).forEach(([hpSection, visSection]) => {
            const view = document.querySelector(`.hp-section-view[data-hp-view="${hpSection}"]`);
            if (!view) return;

            const moduleContent = view.querySelector('.module-content');
            if (!moduleContent) return;

            moduleContent.querySelector('.sv-toggle-container')?.remove();

            const info = SV_LABELS[visSection];
            const container = document.createElement('div');
            container.className = 'sv-toggle-container';
            container.innerHTML = `
                <div class="sv-toggle-bar sv-toggle-bar--readonly">
                    <div class="sv-toggle-left">
                        <i class="${info.icon}"></i>
                        <span class="sv-toggle-label">${escapeHomepageHtml(info.label)} 显示状态</span>
                        <span class="sv-toggle-site">${escapeHomepageHtml(getHomepageSiteLabel('all'))}</span>
                    </div>
                    <div class="sv-toggle-right">
                        <span class="hp-readonly-chip">只读对比</span>
                    </div>
                </div>
                <div class="hp-aggregate-visibility-grid">
                    ${buildHomepageAggregateVisibilityRows(hpSection)}
                </div>
                <div class="sv-warning hp-aggregate-warning hp-aggregate-warning--visible">
                    当前为全部站点视图，只展示各站分栏状态。切换到具体站点后才能调整显隐。
                </div>
            `;

            moduleContent.insertBefore(container, moduleContent.firstChild);
        });

        renderFooterVisibilityToggle(getHomepageSiteLabel('all'));
    }

    function renderAllVisibilityToggles() {
        const site = getAdminSite();
        const siteLabel = getHomepageSiteLabel(site);

        if (isHomepageAggregateMode(site)) {
            renderHomepageAggregateVisibilityToggles();
            return;
        }

        // Map: homepage section → visibility section
        const sectionMap = {
            hero: 'hero',
            prompts: 'gallery',
            shop: 'shop',
            verify: 'verify',
            guestbook: 'guestbook'
        };

        // Render toggle in each section view (except ticker)
        Object.entries(sectionMap).forEach(([hpSection, visSection]) => {
            const view = document.querySelector(`.hp-section-view[data-hp-view="${hpSection}"]`);
            if (!view) return;

            const moduleContent = view.querySelector('.module-content');
            if (!moduleContent) return;

            // Remove existing toggle bar if any
            const existing = moduleContent.querySelector('.sv-toggle-container');
            if (existing) existing.remove();

            const isVisible = configCache[hpSection]?.is_visible !== false;
            const info = SV_LABELS[visSection];

            const container = document.createElement('div');
            container.className = 'sv-toggle-container';
            container.innerHTML = `
                <div class="sv-toggle-bar ${isVisible ? '' : 'sv-off'}" id="sv-bar-${visSection}">
                    <div class="sv-toggle-left">
                        <i class="${info.icon}"></i>
                        <span class="sv-toggle-label">分栏显示</span>
                        <span class="sv-toggle-site">${siteLabel}</span>
                    </div>
                    <div class="sv-toggle-right">
                        <label class="sv-toggle-switch">
                            <input type="checkbox" ${isVisible ? 'checked' : ''}
                                   data-homepage-visibility="${visSection}">
                            <span class="sv-toggle-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="sv-warning" id="sv-warn-${visSection}">
                    ⚠️ 该分栏在 ${siteLabel} 已关闭 — 用户将无法在首页、导航栏和独立页面中看到此部分。
                </div>
            `;

            bindSectionVisibilityToggle(container.querySelector(`[data-homepage-visibility="${visSection}"]`), visSection);

            // Insert at very top of module-content
            moduleContent.insertBefore(container, moduleContent.firstChild);
        });

        // Also render footer toggle inside the last section (guestbook) save bar area
        renderFooterVisibilityToggle(siteLabel);
    }

    function renderFooterVisibilityToggle(siteLabel) {
        const guestbookView = document.querySelector('.hp-section-view[data-hp-view="guestbook"]');
        if (!guestbookView) return;

        const moduleContent = guestbookView.querySelector('.module-content');
        if (!moduleContent) return;

        // Remove existing footer toggle
        const existing = moduleContent.querySelector('.sv-footer-card');
        if (existing) existing.remove();

        if (isHomepageAggregateMode()) {
            const card = document.createElement('div');
            card.className = 'sv-footer-card';
            card.innerHTML = `
                <div class="sv-toggle-bar sv-toggle-bar--readonly">
                    <div class="sv-toggle-left">
                        <i class="${SV_LABELS.footer.icon}"></i>
                        <span class="sv-toggle-label">${escapeHomepageHtml(SV_LABELS.footer.label)}</span>
                        <span class="sv-toggle-site">${escapeHomepageHtml(siteLabel)}</span>
                    </div>
                    <div class="sv-toggle-right">
                        <span class="hp-readonly-chip">只读对比</span>
                    </div>
                </div>
                <div class="hp-aggregate-visibility-grid">
                    ${buildHomepageAggregateVisibilityRows('footer')}
                </div>
                <div class="sv-warning hp-aggregate-warning hp-aggregate-warning--visible">
                    当前为全部站点视图，只展示页脚状态。切换到具体站点后才能修改。
                </div>
            `;
            moduleContent.appendChild(card);
            return;
        }

        const isVisible = configCache.footer?.is_visible !== false;
        const info = SV_LABELS.footer;

        const card = document.createElement('div');
        card.className = 'sv-footer-card';
        card.innerHTML = `
            <div class="sv-toggle-bar ${isVisible ? '' : 'sv-off'}" id="sv-bar-footer">
                <div class="sv-toggle-left">
                    <i class="${info.icon}"></i>
                    <span class="sv-toggle-label">${info.label}</span>
                    <span class="sv-toggle-site">${siteLabel}</span>
                </div>
                <div class="sv-toggle-right">
                    <label class="sv-toggle-switch">
                        <input type="checkbox" ${isVisible ? 'checked' : ''}
                               data-homepage-visibility="footer">
                        <span class="sv-toggle-slider"></span>
                    </label>
                </div>
            </div>
            <div class="sv-warning" id="sv-warn-footer">
                ⚠️ 页脚在 ${siteLabel} 已关闭 — 页面底部将不显示页脚链接区域。
            </div>
        `;

        bindSectionVisibilityToggle(card.querySelector('[data-homepage-visibility="footer"]'), 'footer');
        moduleContent.appendChild(card);
    }

    function renderHomepageAggregateSummaries() {
        document.querySelectorAll('.hp-aggregate-readonly-card').forEach((node) => node.remove());

        if (!isHomepageAggregateMode()) {
            return;
        }

        ['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker'].forEach((section) => {
            const view = document.querySelector(`.hp-section-view[data-hp-view="${section}"]`);
            const moduleContent = view?.querySelector('.module-content');
            if (!moduleContent) return;

            const card = document.createElement('div');
            card.className = 'hp-aggregate-readonly-card';
            card.innerHTML = `
                <div class="hp-aggregate-readonly-card__header">
                    <div class="hp-aggregate-readonly-card__title"><i class="fas fa-columns"></i> CN / INTL 配置概览</div>
                    <div class="hp-aggregate-readonly-card__hint">聚合视图只做对比展示，不承载编辑。</div>
                </div>
                <div class="hp-aggregate-readonly-grid">
                    ${['cn', 'intl'].map((site) => {
                        const cfg = getHomepageSectionConfigBySite(section, site);
                        const summaryLines = buildHomepageSectionSummaryLines(section, cfg);
                        const updatedAt = cfg?.updated_at
                            ? new Date(cfg.updated_at).toLocaleString('zh-CN')
                            : '未更新';
                        const isVisible = cfg?.is_visible !== false;

                        return `
                            <div class="hp-aggregate-site-card">
                                <div class="hp-aggregate-site-card__header">
                                    <span class="hp-aggregate-site-card__site">${escapeHomepageHtml(getHomepageSiteLabel(site))}</span>
                                    <span class="status-badge ${isVisible ? 'active' : 'banned'}">${isVisible ? '已显示' : '已隐藏'}</span>
                                </div>
                                <div class="hp-aggregate-site-card__updated">最后更新: ${escapeHomepageHtml(updatedAt)}</div>
                                <div class="hp-aggregate-site-card__lines">
                                    ${summaryLines.map((line) => `
                                        <div class="hp-aggregate-site-card__line">
                                            <span class="hp-aggregate-site-card__label">${escapeHomepageHtml(line.label)}</span>
                                            <span class="hp-aggregate-site-card__value">${line.value}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            const anchor = moduleContent.querySelector('.sv-toggle-container');
            if (anchor?.nextSibling) {
                moduleContent.insertBefore(card, anchor.nextSibling);
            } else if (anchor) {
                moduleContent.appendChild(card);
            } else {
                moduleContent.insertBefore(card, moduleContent.firstChild);
            }
        });
    }

    function bindSectionVisibilityToggle(input, section) {
        if (!input || input.dataset.homepageVisibilityBound === '1') return;

        input.dataset.homepageVisibilityBound = '1';
        input.addEventListener('change', () => {
            toggleSectionVisibility(section, input.checked);
        });
    }

    async function saveHomepageSectionVisibility(section, checked, site) {
        const hpSection = VIS_TO_SECTION[section] || section;
        const cfg = configCache[hpSection];
        if (!cfg?.id) {
            throw new Error(`缺少 ${hpSection} 区块配置，无法保存显示状态`);
        }

        const previousValue = cfg.is_visible !== false;
        cfg.is_visible = checked;
        setToggle(`hp-${hpSection}-visible`, checked);

        try {
            const result = await updateHomepageConfigRow({
                id: cfg.id,
                section: hpSection,
                site,
                is_visible: checked
            });
            const savedRow = result.row || {};

            cfg.updated_at = savedRow.updated_at || new Date().toISOString();
            cfg.site = normalizeHomepageSite(savedRow.site || site);
            cfg.is_visible = savedRow.is_visible !== false;
            const updatedEl = document.getElementById(`hp-${hpSection}-updated`);
            if (updatedEl) {
                updatedEl.textContent = `最后更新: ${new Date().toLocaleString('zh-CN')}`;
            }

            invalidateHomepageRuntimeCaches(site);
            invalidateSectionVisibilityCaches();
            renderAllVisibilityToggles();

            if (typeof showToast === 'function') {
                showToast('分栏显示设置已保存', 'success');
            }
        } catch (err) {
            cfg.is_visible = previousValue;
            setToggle(`hp-${hpSection}-visible`, previousValue);
            renderAllVisibilityToggles();
            throw err;
        }
    }

    async function toggleSectionVisibility(section, checked) {
        const site = requireWritableHomepageSite({ label: '调整首页分栏显示' });
        if (!site) {
            renderAllVisibilityToggles();
            return;
        }

        try {
            await saveHomepageSectionVisibility(section, checked, site);
        } catch (err) {
            console.error('[Homepage] Failed to save homepage section visibility:', err);
            if (typeof showToast === 'function') {
                showToast('保存失败: ' + err.message, 'error');
            }
        }
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================

    function setupEventListeners() {
        // Ticker speed range slider - update label in real time
        const speedSlider = document.getElementById('hp-ticker-speed');
        const speedLabel = document.getElementById('hp-ticker-speed-label');
        if (speedSlider && speedLabel) {
            speedSlider.addEventListener('input', () => {
                speedLabel.textContent = speedSlider.value;
            });
        }

        // Shop scroll speed slider
        const shopSpeedSlider = document.getElementById('hp-ticker-shop-speed');
        const shopSpeedLabel = document.getElementById('hp-ticker-shop-speed-label');
        if (shopSpeedSlider && shopSpeedLabel) {
            shopSpeedSlider.addEventListener('input', () => {
                shopSpeedLabel.textContent = shopSpeedSlider.value;
            });
        }

        // Initialize section view visibility
        document.querySelectorAll('.hp-section-view').forEach(view => {
            const isActive = view.classList.contains('active');
            setHomepageSectionViewState(view, isActive);
        });

        // Listen for admin site filter change to reload visibility toggles
        window.addEventListener('admin-site-changed', async () => {
            if (!initialized) return;

            try {
                await loadAllConfig();
                renderCurrentSection();
            } catch (err) {
                console.error('[Homepage] Failed to reload config for new site:', err);
                if (typeof showToast === 'function') {
                    showToast('首页配置切站刷新失败: ' + err.message, 'error');
                }
            }
        });
    }

    // ============================================
    // SCREENSHOT UPLOAD
    // ============================================

    function _handleScreenshotUpload(input) {
        const file = input.files && input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Compress & convert to WebP via Canvas
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                let w = img.width, h = img.height;
                const MAX = 1200; // max dimension
                if (w > MAX || h > MAX) {
                    if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                    else { w = Math.round(w * MAX / h); h = MAX; }
                }
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);

                // Convert to WebP (80% quality)
                const webpData = canvas.toDataURL('image/webp', 0.8);

                // Update preview
                const previewImg = document.getElementById('hp-verify-preview-img');
                const placeholder = document.getElementById('hp-verify-upload-placeholder');
                if (previewImg) {
                    previewImg.src = webpData;
                }
                setHomepagePreviewState(previewImg, placeholder, true);

                // Store WebP base64 data directly (will be saved to DB)
                setInputValue('hp-verify-screenshot', webpData);

                // Log compression info
                const originalKB = (file.size / 1024).toFixed(1);
                const compressedKB = (webpData.length * 0.75 / 1024).toFixed(1); // approx base64 → bytes
                console.log(`📸 Screenshot: ${img.width}x${img.height} → ${w}x${h}, ${originalKB}KB → ~${compressedKB}KB WebP`);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function _updateScreenshotPreview(path) {
        const img = document.getElementById('hp-verify-preview-img');
        const placeholder = document.getElementById('hp-verify-upload-placeholder');
        if (!img || !placeholder) return;

        if (path) {
            img.src = path;
            setHomepagePreviewState(img, placeholder, true);
            // Handle load error — show placeholder again
            img.onerror = () => {
                setHomepagePreviewState(img, placeholder, false);
            };
        } else {
            setHomepagePreviewState(img, placeholder, false);
        }
    }

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        init,
        prefetch,
        ensureLoaded: ensureHomepageConfigLoaded,
        switchSection,
        saveSection,
        toggleVisible,
        toggleField,
        toggleSectionVisibility,
        addFeaturedPrompt,
        addFeaturedPrompts,
        removeFeaturedPrompt,
        moveFeaturedPrompt,
        isPromptFeatured,
        getFeaturedPromptSites: getHomepageFeaturedPromptSites,
        openPromptSectionContext,
        _handleScreenshotUpload
    };
})();

// Expose globally
window.HomepageAdmin = HomepageAdmin;
