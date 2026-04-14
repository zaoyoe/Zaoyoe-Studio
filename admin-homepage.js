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
    let publishedConfigCacheBySite = { cn: {}, intl: {} };
    let homepageDraftMetaBySite = { cn: null, intl: null };
    let homepageReleaseMetaBySite = { cn: [], intl: [] };
    let homepageHealthBySite = { cn: null, intl: null };
    let homepageContextBySite = { cn: null, intl: null };
    let homepageContextLoadingBySite = { cn: null, intl: null };
    let currentSection = 'hero';
    let currentReadSite = 'all';
    let initialized = false;
    let loadingPromise = null;
    let loadingSite = '';
    let previewLanguage = 'zh';
    let previewDevice = 'desktop';
    let homepageFeaturedPromptPendingState = null;
    let homepageCustomSelectDocumentBound = false;

    const HomepageContract = window.HomepageContract || null;

    const SV_LABELS = {
        hero: { icon: 'fas fa-image', label: 'Hero 横幅' },
        prompts: { icon: 'fas fa-palette', label: '提示词图库' },
        shop: { icon: 'fas fa-store', label: '资源商城' },
        verify: { icon: 'fas fa-shield-alt', label: 'API 验证' },
        guestbook: { icon: 'fas fa-comment-dots', label: '留言板' },
        ticker: { icon: 'fas fa-wave-square', label: '底部跑马灯' }
    };
    const VIS_TO_SECTION = { hero: 'hero', prompts: 'prompts', gallery: 'prompts', shop: 'shop', verify: 'verify', guestbook: 'guestbook', ticker: 'ticker' };
    const HOMEPAGE_ADMIN_HIDDEN_CLASS = 'admin-studio-inline-style-attr-3';
    const HOMEPAGE_ADMIN_PREVIEW_HIDDEN_CLASS = 'admin-studio-inline-style-attr-149';
    const HOMEPAGE_PREFETCH_CACHE_KEY = 'homepage_prefetch';
    const HOMEPAGE_CONFIG_LAST_UPDATED_KEY = 'homepage_config_last_updated_at';
    const HOMEPAGE_MANAGED_SECTIONS = Array.isArray(HomepageContract?.MANAGED_SECTION_ORDER)
        ? [...HomepageContract.MANAGED_SECTION_ORDER]
        : ['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker'];
    const HOMEPAGE_OVERVIEW_SECTION = 'overview';
    const HOMEPAGE_DEFAULT_SECTION = HOMEPAGE_MANAGED_SECTIONS[0] || 'hero';
    const HOMEPAGE_TAB_SECTIONS = Object.freeze([HOMEPAGE_OVERVIEW_SECTION, ...HOMEPAGE_MANAGED_SECTIONS]);

    function normalizeHomepageAdminSection(section, fallback = currentSection || HOMEPAGE_DEFAULT_SECTION) {
        const normalized = String(section || '').trim().toLowerCase();
        if (HOMEPAGE_TAB_SECTIONS.includes(normalized)) {
            return normalized;
        }
        return HOMEPAGE_TAB_SECTIONS.includes(fallback) ? fallback : HOMEPAGE_DEFAULT_SECTION;
    }

    function normalizeHomepageSite(site) {
        return HomepageContract?.normalizeSite?.(site, { allowAll: true })
            || (site === 'intl' ? 'intl' : (site === 'all' ? 'all' : 'cn'));
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

    function waitForHomepageNextPaint() {
        return new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        });
    }

    async function runHomepageOpsActionButton(button, options = {}) {
        if (!(button instanceof HTMLElement) || button.disabled || button.dataset.hpBusy === '1') {
            return false;
        }

        const {
            busyText = '',
            action
        } = options;

        if (typeof action !== 'function') {
            return false;
        }

        const idleText = button.dataset.hpIdleText || button.textContent.trim();
        button.dataset.hpIdleText = idleText;
        button.dataset.hpBusy = '1';
        button.classList.remove('is-feedback');
        button.classList.add('is-busy');
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        if (busyText) {
            button.textContent = busyText;
        }

        await waitForHomepageNextPaint();

        try {
            return await action();
        } finally {
            if (button.isConnected) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
                button.dataset.hpBusy = '0';
                button.classList.remove('is-busy');
                button.classList.add('is-feedback');
                button.textContent = idleText;
                window.setTimeout(() => {
                    if (button.isConnected) {
                        button.classList.remove('is-feedback');
                    }
                }, 180);
            }
        }
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

    function buildHomepageCustomSelect({ id, value = '', options = [], placeholder = '请选择', disabled = false, className = '' } = {}) {
        const safeOptions = Array.isArray(options)
            ? options.map((option) => ({
                value: String(option?.value ?? ''),
                label: String(option?.label ?? option?.value ?? '')
            }))
            : [];
        const fallbackOption = { value: '', label: placeholder };
        const selectedOption = safeOptions.find((option) => option.value === String(value ?? ''))
            || safeOptions[0]
            || fallbackOption;
        const safeId = escapeHomepageHtml(id);
        const resolvedDisabled = disabled || safeOptions.length === 0;

        return `
            <div class="hp-custom-select ${className ? escapeHomepageHtml(className) : ''} ${resolvedDisabled ? 'is-disabled' : ''}" data-homepage-custom-select>
                <input type="hidden" id="${safeId}" value="${escapeHomepageHtml(selectedOption.value)}" data-homepage-custom-select-value>
                <button type="button" class="hp-custom-select__button" data-homepage-custom-select-toggle aria-haspopup="listbox" aria-expanded="false" ${resolvedDisabled ? 'disabled' : ''}>
                    <span data-homepage-custom-select-label>${escapeHomepageHtml(selectedOption.label || placeholder)}</span>
                    <i class="fas fa-chevron-down" aria-hidden="true"></i>
                </button>
                <div class="hp-custom-select__menu" role="listbox" hidden>
                    ${(safeOptions.length ? safeOptions : [fallbackOption]).map((option) => `
                        <button type="button" class="hp-custom-select__option ${option.value === selectedOption.value ? 'is-selected' : ''}" role="option" aria-selected="${option.value === selectedOption.value ? 'true' : 'false'}" data-homepage-custom-select-option data-value="${escapeHomepageHtml(option.value)}">
                            ${escapeHomepageHtml(option.label)}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    async function fetchHomepageConfigRows(site = getHomepageReadSite()) {
        const normalizedSite = normalizeHomepageSite(site);
        const searchParams = new URLSearchParams({
            site: normalizedSite
        });
        if (normalizedSite !== 'all') {
            searchParams.set('include_draft', '1');
        }

        const response = await (window.AdminApi?.fetch || fetch)(
            `/api/admin/homepage/config?${searchParams.toString()}`,
            {
                credentials: 'include'
            }
        );

        return parseHomepageAdminResponse(response);
    }

    function buildHomepageConfigRecord(row = {}) {
        const normalizedSection = HomepageContract?.normalizeSection?.(row.section) || String(row.section || '').trim().toLowerCase();
        return {
            id: row.id || null,
            site: normalizeHomepageSite(row.site),
            section: normalizedSection,
            content: HomepageContract?.normalizeContent?.(normalizedSection, row.content)
                || (row.content && typeof row.content === 'object' && !Array.isArray(row.content) ? row.content : {}),
            is_visible: row.is_visible !== false,
            display_order: Number(row.display_order ?? HomepageContract?.getDefaultDisplayOrder?.(normalizedSection) ?? 0) || 0,
            updated_at: row.updated_at || null
        };
    }

    function buildEmptyHomepageSectionContent(section) {
        return HomepageContract?.buildEmptySectionContent?.(section) || { enable_auto: false };
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
        const normalizedSection = HomepageContract?.normalizeSection?.(section) || String(section || '').trim().toLowerCase();
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return configCache[normalizedSection] || null;
        }
        return configCacheBySite[normalizedSite]?.[normalizedSection] || null;
    }

    function getHomepagePublishedSectionConfigBySite(section, site) {
        const normalizedSection = HomepageContract?.normalizeSection?.(section) || String(section || '').trim().toLowerCase();
        const normalizedSite = normalizeHomepageSite(site);
        return publishedConfigCacheBySite[normalizedSite]?.[normalizedSection] || null;
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

    function getHomepageFeaturedPromptPendingState(site = getHomepageReadSite()) {
        if (!homepageFeaturedPromptPendingState) {
            return null;
        }

        return normalizeHomepageSite(homepageFeaturedPromptPendingState.site) === normalizeHomepageSite(site)
            ? homepageFeaturedPromptPendingState
            : null;
    }

    function setHomepageFeaturedPromptPendingState(state = null) {
        homepageFeaturedPromptPendingState = state && typeof state === 'object'
            ? {
                ...state,
                site: normalizeHomepageSite(state.site || getHomepageReadSite())
            }
            : null;
    }

    function setHomepageFeaturedPromptItemsForSite(site, items) {
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return false;
        }

        const siteCache = configCacheBySite[normalizedSite] || {};
        const promptsConfig = siteCache.prompts;
        if (!promptsConfig) {
            return false;
        }

        configCacheBySite[normalizedSite] = {
            ...siteCache,
            prompts: {
                ...promptsConfig,
                content: {
                    ...(promptsConfig.content || {}),
                    enable_auto: false,
                    featured_items: normalizeHomepageFeaturedPromptItems(items)
                }
            }
        };

        if (normalizeHomepageSite(currentReadSite) === normalizedSite) {
            applyHomepageConfigForSite(normalizedSite);
        }

        return true;
    }

    function restoreHomepageFeaturedPromptListScroll(scrollTop = 0) {
        window.requestAnimationFrame(() => {
            const container = document.getElementById('hp-prompts-featured-list');
            if (container) {
                container.scrollTop = Math.max(0, Number(scrollTop) || 0);
            }
        });
    }

    const HOMEPAGE_SCROLL_CHAIN_SELECTOR = [
        '#hp-prompts-featured-list',
        '#hp-prompts-candidate-list',
        '#hp-shop-product-list',
        '#hp-shop-curated-list',
        '#hp-guestbook-candidate-list',
        '#hp-guestbook-featured-list',
        '#hp-guestbook-fallback-list',
        '#hp-hero-entries-list',
        '.hp-section-view[data-hp-view="ticker"] .config-card-body',
        '.hp-multiline-input'
    ].join(', ');

    function findHomepageScrollableParent(node, homepageModule) {
        let current = node instanceof Element ? node : node?.parentElement || null;
        while (current && current !== homepageModule && current !== document.body) {
            const style = window.getComputedStyle(current);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight + 1) {
                return current;
            }
            current = current.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    function canHomepageScrollableConsumeDelta(scrollable, deltaY) {
        if (!(scrollable instanceof HTMLElement)) {
            return false;
        }

        if (scrollable.scrollHeight <= scrollable.clientHeight + 1) {
            return false;
        }

        if (deltaY < 0) {
            return scrollable.scrollTop > 0;
        }

        if (deltaY > 0) {
            return scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight - 1;
        }

        return false;
    }

    function bindHomepageNestedScrollBridge(homepageModule) {
        if (!homepageModule || homepageModule.dataset.homepageScrollBridgeBound === '1') {
            return;
        }

        homepageModule.dataset.homepageScrollBridgeBound = '1';
        homepageModule.addEventListener('wheel', (event) => {
            if (!homepageModule.classList.contains('active')) {
                return;
            }

            const bridgeTarget = event.target instanceof Element
                ? event.target.closest(HOMEPAGE_SCROLL_CHAIN_SELECTOR)
                : null;
            if (!(bridgeTarget instanceof HTMLElement) || !homepageModule.contains(bridgeTarget)) {
                return;
            }

            const deltaY = Number(event.deltaY) || 0;
            if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.1) {
                return;
            }

            if (canHomepageScrollableConsumeDelta(bridgeTarget, deltaY)) {
                return;
            }

            const nextScrollable = findHomepageScrollableParent(bridgeTarget.parentElement || bridgeTarget, homepageModule);
            if (nextScrollable === bridgeTarget) {
                return;
            }

            if (nextScrollable === document.body || nextScrollable === document.documentElement || nextScrollable === document.scrollingElement) {
                const doc = document.scrollingElement || document.documentElement;
                const maxScrollTop = Math.max(0, doc.scrollHeight - window.innerHeight);
                const nextTop = Math.max(0, Math.min(maxScrollTop, doc.scrollTop + deltaY));
                if (Math.abs(nextTop - doc.scrollTop) < 0.5) {
                    return;
                }
                window.scrollTo({ top: nextTop, behavior: 'auto' });
                event.preventDefault();
                return;
            }

            if (nextScrollable instanceof HTMLElement && canHomepageScrollableConsumeDelta(nextScrollable, deltaY)) {
                nextScrollable.scrollTop += deltaY;
                event.preventDefault();
            }
        }, { passive: false, capture: true });
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
            section: normalizeHomepageAdminSection(requestedSection, currentSection || HOMEPAGE_DEFAULT_SECTION),
            focusPromptId: String(searchParams?.get('homepage_prompt_id') || '').trim()
        };
    }

    function syncHomepageAdminRouteState(nextState = {}, options = {}) {
        const url = getHomepageAdminRouteUrlObject();
        if (!url || typeof window.history?.replaceState !== 'function') {
            return false;
        }

        const currentState = getHomepageAdminRouteState();
        const section = normalizeHomepageAdminSection(
            nextState.section || currentState.section || currentSection || HOMEPAGE_DEFAULT_SECTION,
            currentState.section || currentSection || HOMEPAGE_DEFAULT_SECTION
        );
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
        return;
    }

    function parseHomepageDelimitedList(value) {
        return String(value || '')
            .split(/[\n,，]/g)
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }

    function formatHomepageCount(value) {
        const numericValue = Number(value || 0) || 0;
        return numericValue >= 1000
            ? `${(numericValue / 1000).toFixed(numericValue >= 10000 ? 0 : 1)}k`
            : String(numericValue);
    }

    function formatHomepageLocalDatetimeValue(value) {
        if (!value) {
            return '';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - offset * 60 * 1000);
        return localDate.toISOString().slice(0, 16);
    }

    function parseHomepageLocalDatetimeToIso(value) {
        const normalized = String(value || '').trim();
        if (!normalized) {
            return '';
        }
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        return date.toISOString();
    }

    function buildHomepageMetricPill(label, value, tone = 'default') {
        return `
            <div class="hp-metric-pill hp-metric-pill--${escapeHomepageHtml(tone)}">
                <span>${escapeHomepageHtml(label)}</span>
                <strong>${escapeHomepageHtml(value)}</strong>
            </div>
        `;
    }

    function buildEmptyHomepageAnalyticsFallback() {
        const emptyModule = {
            impressions_7d: 0,
            clicks_7d: 0,
            conversions_7d: 0,
            interactions_7d: 0,
            impressions_30d: 0,
            clicks_30d: 0,
            conversions_30d: 0,
            interactions_30d: 0
        };
        return {
            sections: {
                hero: { ...emptyModule },
                prompts: { ...emptyModule },
                shop: { ...emptyModule },
                verify: { ...emptyModule },
                guestbook: { ...emptyModule },
                ticker: { ...emptyModule }
            }
        };
    }

    const HOMEPAGE_EXPERIMENT_SLOT_DEFS = Object.freeze([
        {
            value: 'hero:title',
            section: 'hero',
            field: 'title',
            label: 'Hero 标题',
            inputKind: 'text',
            placeholder: '输入实验版本标题'
        },
        {
            value: 'hero:subtitle',
            section: 'hero',
            field: 'subtitle',
            label: 'Hero 副标题',
            inputKind: 'text',
            placeholder: '输入实验版本副标题'
        },
        {
            value: 'verify:cta_text',
            section: 'verify',
            field: 'cta_text',
            label: 'Verify CTA',
            inputKind: 'text',
            placeholder: '输入实验 CTA 文案'
        },
        {
            value: 'prompts:featured_items',
            section: 'prompts',
            field: 'featured_items',
            label: 'Prompt 精选清单',
            inputKind: 'list',
            placeholder: '输入候选 Prompt ID，逗号或换行分隔'
        },
        {
            value: 'shop:custom_items',
            section: 'shop',
            field: 'custom_items',
            label: '商城精选清单',
            inputKind: 'list',
            placeholder: '输入商品 ID，逗号或换行分隔'
        },
        {
            value: 'guestbook:featured_items',
            section: 'guestbook',
            field: 'featured_items',
            label: '留言精选清单',
            inputKind: 'list',
            placeholder: '输入留言 ID，逗号或换行分隔'
        }
    ]);

    function formatHomepagePercent(value) {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) {
            return '0%';
        }
        return `${(numeric * 100).toFixed(numeric > 0 && numeric < 0.1 ? 1 : 0)}%`;
    }

    function getHomepageExperimentSlotDefinition(value = '') {
        return HOMEPAGE_EXPERIMENT_SLOT_DEFS.find((item) => item.value === value) || HOMEPAGE_EXPERIMENT_SLOT_DEFS[0];
    }

    function buildHomepageListPreview(value, fallback = '未配置') {
        if (!Array.isArray(value) || !value.length) {
            return fallback;
        }
        return value
            .slice(0, 3)
            .map((item) => String(
                item?.title
                || item?.title_zh
                || item?.title_en
                || item?.name
                || item?.name_en
                || item?.username
                || item?.author
                || item?.content
                || item?.id
                || ''
            ).trim())
            .filter(Boolean)
            .join(' / ') || fallback;
    }

    function getHomepageDefaultHeroEntries() {
        return [
            { id: 'prompts', text: '提示词', text_en: 'Prompts', icon: 'fa-wand-magic-sparkles', color: '#f472b6', link: '/prompts.html', section: 'prompts' },
            { id: 'gongyi', text: '公益站', text_en: 'Community Access', icon: 'home-entry-card-icon--gongyi', color: '#5ed8f8', link: 'https://gongyi.zaoyoe.com', section: 'gongyi' },
            { id: 'shop', text: '商城', text_en: 'Shop', icon: 'fa-store', color: '#4ade80', link: '/shop.html', section: 'shop' },
            { id: 'verify', text: '验证', text_en: 'Verify', icon: 'fa-shield-check', color: '#60a5fa', link: '/verify.html?source=homepage_verify', section: 'verify' },
            { id: 'guestbook', text: '留言板', text_en: 'Guestbook', icon: 'fa-comment-dots', color: '#f59e0b', link: '#', action: 'openGuestbookModal', section: 'guestbook' }
        ];
    }

    function isHomepageGongyiHeroEntry(item) {
        const normalizedId = String(item?.id || '').trim().toLowerCase();
        const normalizedSection = String(item?.section || '').trim().toLowerCase();
        const normalizedLink = String(item?.link || '').trim().toLowerCase();
        return normalizedId === 'gongyi' || normalizedSection === 'gongyi' || normalizedLink.includes('gongyi.zaoyoe.com');
    }

    function withHomepageRequiredHeroEntries(items = []) {
        const sourceItems = Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
        const defaultGongyiEntry = getHomepageDefaultHeroEntries().find((item) => item.id === 'gongyi');
        const existingGongyi = sourceItems.find((item) => isHomepageGongyiHeroEntry(item));
        const nextItems = sourceItems.filter((item) => !isHomepageGongyiHeroEntry(item));
        const normalizedGongyiEntry = {
            ...defaultGongyiEntry,
            ...(existingGongyi || {}),
            id: 'gongyi',
            text: String(existingGongyi?.text || defaultGongyiEntry?.text || '').trim() || defaultGongyiEntry.text,
            text_en: String(existingGongyi?.text_en || defaultGongyiEntry?.text_en || '').trim() || defaultGongyiEntry.text_en,
            link: String(existingGongyi?.link || defaultGongyiEntry?.link || '').trim() || defaultGongyiEntry.link,
            icon: String(existingGongyi?.icon || defaultGongyiEntry?.icon || '').trim() || defaultGongyiEntry.icon,
            color: String(existingGongyi?.color || defaultGongyiEntry?.color || '').trim() || defaultGongyiEntry.color,
            section: String(existingGongyi?.section || defaultGongyiEntry?.section || '').trim() || defaultGongyiEntry.section
        };

        delete normalizedGongyiEntry.enabled;

        const shopIndex = nextItems.findIndex((item) => {
            const normalizedId = String(item?.id || '').trim().toLowerCase();
            const normalizedSection = String(item?.section || '').trim().toLowerCase();
            const normalizedLink = String(item?.link || '').trim().toLowerCase();
            return normalizedId === 'shop' || normalizedSection === 'shop' || normalizedLink.includes('/shop.html');
        });
        const insertionIndex = shopIndex >= 0 ? shopIndex : Math.min(1, nextItems.length);
        nextItems.splice(insertionIndex, 0, normalizedGongyiEntry);

        return nextItems.slice(0, 8);
    }

    function getHomepageCurrentSectionContent(section) {
        const cfg = configCache[section];
        return cfg?.content && typeof cfg.content === 'object'
            ? cfg.content
            : buildEmptyHomepageSectionContent(section);
    }

    function replaceHomepageSectionContent(section, updater) {
        const cfg = configCache[section];
        if (!cfg) return null;
        const currentContent = getHomepageCurrentSectionContent(section);
        const nextContent = typeof updater === 'function'
            ? updater({ ...currentContent })
            : currentContent;
        cfg.content = HomepageContract?.normalizeContent?.(section, nextContent) || nextContent;
        return cfg.content;
    }

    async function requestHomepageConfigMutation(payload = {}) {
        const response = await (window.AdminApi?.fetch || fetch)('/api/admin/homepage/config', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        return parseHomepageAdminResponse(response);
    }

    async function saveHomepageDraftRow({
        section,
        site,
        content,
        is_visible,
        display_order
    }) {
        return requestHomepageConfigMutation({
            action: 'save_draft',
            section,
            site: normalizeHomepageSite(site),
            content,
            is_visible,
            display_order
        });
    }

    async function publishHomepageDraft(site) {
        return requestHomepageConfigMutation({
            action: 'publish',
            site: normalizeHomepageSite(site)
        });
    }

    async function rollbackHomepageDraft(site, releaseId = '') {
        return requestHomepageConfigMutation({
            action: 'rollback',
            site: normalizeHomepageSite(site),
            release_id: releaseId || undefined
        });
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

    function closeHomepageCustomSelect(select) {
        if (!select) return;
        select.classList.remove('is-open');
        const toggle = select.querySelector('[data-homepage-custom-select-toggle]');
        const menu = select.querySelector('.hp-custom-select__menu');
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
        }
        if (menu) {
            menu.hidden = true;
        }
    }

    function closeHomepageCustomSelects(except = null) {
        document.querySelectorAll('#module-homepage [data-homepage-custom-select].is-open').forEach((select) => {
            if (select !== except) {
                closeHomepageCustomSelect(select);
            }
        });
    }

    function setHomepageCustomSelectValue(select, value, options = {}) {
        if (!select) return false;
        const hiddenInput = select.querySelector('[data-homepage-custom-select-value]');
        const label = select.querySelector('[data-homepage-custom-select-label]');
        const optionButtons = Array.from(select.querySelectorAll('[data-homepage-custom-select-option]'));
        const nextValue = String(value ?? '');
        const selectedOption = optionButtons.find((option) => option.dataset.value === nextValue) || optionButtons[0] || null;
        const resolvedValue = selectedOption?.dataset.value ?? nextValue;

        if (hiddenInput) {
            hiddenInput.value = resolvedValue;
        }
        if (label) {
            label.textContent = selectedOption?.textContent?.trim() || '';
        }
        optionButtons.forEach((option) => {
            const isSelected = option === selectedOption;
            option.classList.toggle('is-selected', isSelected);
            option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });

        if (options.dispatchChange !== false && hiddenInput) {
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    }

    function setHomepageCustomSelectValueById(id, value, options = {}) {
        const input = document.getElementById(id);
        const select = input?.closest?.('[data-homepage-custom-select]');
        if (select) {
            return setHomepageCustomSelectValue(select, value, options);
        }
        if (input) {
            input.value = value ?? '';
            if (options.dispatchChange !== false) {
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }
        return false;
    }

    function bindHomepageCustomSelects(root = document) {
        if (!root?.querySelectorAll) return;

        root.querySelectorAll('[data-homepage-custom-select]').forEach((select) => {
            if (select.dataset.homepageCustomSelectBound === '1') return;
            select.dataset.homepageCustomSelectBound = '1';

            const toggle = select.querySelector('[data-homepage-custom-select-toggle]');
            toggle?.addEventListener('click', (event) => {
                event.stopPropagation();
                if (toggle.disabled) return;
                const shouldOpen = !select.classList.contains('is-open');
                closeHomepageCustomSelects(select);
                select.classList.toggle('is-open', shouldOpen);
                toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
                const menu = select.querySelector('.hp-custom-select__menu');
                if (menu) {
                    menu.hidden = !shouldOpen;
                }
            });

            select.querySelectorAll('[data-homepage-custom-select-option]').forEach((option) => {
                option.addEventListener('click', (event) => {
                    event.stopPropagation();
                    setHomepageCustomSelectValue(select, event.currentTarget.dataset.value || '');
                    closeHomepageCustomSelect(select);
                    toggle?.focus?.();
                });
            });
        });

        if (!homepageCustomSelectDocumentBound) {
            homepageCustomSelectDocumentBound = true;
            document.addEventListener('click', (event) => {
                if (!event.target.closest?.('[data-homepage-custom-select]')) {
                    closeHomepageCustomSelects();
                }
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    closeHomepageCustomSelects();
                }
            });
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
            currentSection = normalizeHomepageAdminSection(routeState.section, currentSection || HOMEPAGE_DEFAULT_SECTION);
        }

        if (initialized) {
            await ensureHomepageConfigLoaded();
            renderAllSections();
            switchSection(currentSection);
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
            switchSection(currentSection);

            console.log('[Homepage] Initialized successfully');
        } catch (err) {
            console.error('[Homepage] Init error:', err);
            renderHomepageLoadingError(loading, err.message);
        }
    }

    async function refreshHomepageOpsConfig() {
        await ensureHomepageConfigLoaded({ force: true });
        renderAllSections();
        renderCurrentSection();
        return true;
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
        const publishedRows = Array.isArray(result.published_rows) ? result.published_rows : rows;

        if (isHomepageAggregateMode(currentReadSite)) {
            configCacheBySite = { cn: {}, intl: {} };
            publishedConfigCacheBySite = { cn: {}, intl: {} };

            rows.forEach((row) => {
                const entry = buildHomepageConfigRecord(row);
                if (!entry.section || entry.site === 'all') {
                    return;
                }
                configCacheBySite[entry.site][entry.section] = entry;
                publishedConfigCacheBySite[entry.site][entry.section] = entry;
            });
        } else {
            const normalizedSite = normalizeHomepageSite(currentReadSite);
            configCacheBySite[normalizedSite] = buildHomepageSectionCache(rows);
            publishedConfigCacheBySite[normalizedSite] = buildHomepageSectionCache(publishedRows);
            homepageDraftMetaBySite[normalizedSite] = result.draft || null;
            homepageReleaseMetaBySite[normalizedSite] = Array.isArray(result.releases) ? result.releases : [];
            homepageHealthBySite[normalizedSite] = result.health || null;
        }

        configCache = isHomepageAggregateMode(currentReadSite)
            ? buildAggregateHomepageConfigCache(configCacheBySite)
            : { ...(configCacheBySite[normalizeHomepageSite(currentReadSite)] || {}) };

        if (!isHomepageAggregateMode(currentReadSite)) {
            try {
                await ensureHomepageContextLoaded(currentReadSite, { force: true });
            } catch (error) {
                console.warn('[Homepage] Failed to load orchestration context:', error);
            }
        }

        console.log('[Homepage] Loaded config for site:', currentReadSite, Object.keys(configCache));

        // Render all sections
        renderAllSections();
    }

    // ============================================
    // RENDER
    // ============================================

    function renderAllSections() {
        renderHomepageOpsShell();
        HOMEPAGE_MANAGED_SECTIONS.forEach(section => {
            renderSection(section);
        });
        renderHomepageReadModeBanner();
        setHomepageEditorReadOnlyState();
        // Render visibility toggles for all sections
        renderAllVisibilityToggles();
        renderHomepageAggregateSummaries();
    }

    function formatHomepageTime(value) {
        if (!value) {
            return '未记录';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '未记录';
        }

        return date.toLocaleString('zh-CN');
    }

    function getLocalizedHomepageField(content, fieldBase) {
        if (HomepageContract?.getLocalizedField) {
            return HomepageContract.getLocalizedField(content, fieldBase, previewLanguage) || '';
        }

        const langField = `${fieldBase}_${previewLanguage}`;
        return content?.[langField] || content?.[fieldBase] || '';
    }

    function getHomepageDraftMeta(site = currentReadSite) {
        return homepageDraftMetaBySite[normalizeHomepageSite(site)] || null;
    }

    function getHomepageReleaseMeta(site = currentReadSite) {
        return homepageReleaseMetaBySite[normalizeHomepageSite(site)] || [];
    }

    function getHomepageHealth(site = currentReadSite) {
        return homepageHealthBySite[normalizeHomepageSite(site)] || null;
    }

    function getHomepageContext(site = currentReadSite) {
        return homepageContextBySite[normalizeHomepageSite(site)] || null;
    }

    function getHomepageContextExperiments(site = currentReadSite) {
        return Array.isArray(getHomepageContext(site)?.experiments)
            ? getHomepageContext(site).experiments
            : [];
    }

    function getHomepageContextRecommendations(site = currentReadSite) {
        const recommendations = getHomepageContext(site)?.recommendations;
        return recommendations && typeof recommendations === 'object'
            ? recommendations
            : { signals: [], items: [] };
    }

    function getHomepageContextAlerts(site = currentReadSite) {
        const alerts = getHomepageContext(site)?.alerts;
        return alerts && typeof alerts === 'object'
            ? alerts
            : { generated_at: '', items: [] };
    }

    function getHomepageContextReports(site = currentReadSite) {
        const reports = getHomepageContext(site)?.reports;
        return reports && typeof reports === 'object'
            ? reports
            : { daily: { title: '', lines: [] }, weekly: { title: '', lines: [] } };
    }

    function getHomepageContextThemePacks(site = currentReadSite) {
        return Array.isArray(getHomepageContext(site)?.theme_packs)
            ? getHomepageContext(site).theme_packs
            : [];
    }

    async function fetchHomepageContext(site = getHomepageReadSite()) {
        const normalizedSite = normalizeHomepageSite(site);
        const response = await (window.AdminApi?.fetch || fetch)(
            `/api/admin/homepage/context?site=${encodeURIComponent(normalizedSite)}`,
            {
                credentials: 'include'
            }
        );
        return parseHomepageAdminResponse(response);
    }

    async function requestHomepageContextMutation(payload = {}) {
        const response = await (window.AdminApi?.fetch || fetch)('/api/admin/homepage/context', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        return parseHomepageAdminResponse(response);
    }

    function applyHomepageContextPayload(site, payload = {}) {
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return;
        }
        homepageContextBySite[normalizedSite] = {
            site: normalizedSite,
            shop_categories: Array.isArray(payload.shop_categories) ? payload.shop_categories : [],
            shop_products: Array.isArray(payload.shop_products) ? payload.shop_products : [],
            guestbook_messages: Array.isArray(payload.guestbook_messages) ? payload.guestbook_messages : [],
            prompt_candidates: Array.isArray(payload.prompt_candidates) ? payload.prompt_candidates : [],
            analytics: payload.analytics && typeof payload.analytics === 'object' ? payload.analytics : null,
            templates: Array.isArray(payload.templates) ? payload.templates : [],
            schedules: Array.isArray(payload.schedules) ? payload.schedules : [],
            experiments: Array.isArray(payload.experiments) ? payload.experiments : [],
            recommendations: payload.recommendations && typeof payload.recommendations === 'object'
                ? payload.recommendations
                : { signals: [], items: [] },
            alerts: payload.alerts && typeof payload.alerts === 'object'
                ? payload.alerts
                : { generated_at: '', items: [] },
            reports: payload.reports && typeof payload.reports === 'object'
                ? payload.reports
                : { daily: { title: '', lines: [] }, weekly: { title: '', lines: [] } },
            theme_packs: Array.isArray(payload.theme_packs) ? payload.theme_packs : [],
            orchestration_support: payload.orchestration_support && typeof payload.orchestration_support === 'object'
                ? payload.orchestration_support
                : null
        };
    }

    async function ensureHomepageContextLoaded(site = getHomepageReadSite(), { force = false } = {}) {
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return null;
        }

        if (!force && homepageContextBySite[normalizedSite]) {
            return homepageContextBySite[normalizedSite];
        }

        if (!force && homepageContextLoadingBySite[normalizedSite]) {
            return homepageContextLoadingBySite[normalizedSite];
        }

        homepageContextLoadingBySite[normalizedSite] = Promise.resolve()
            .then(async () => {
                const payload = await fetchHomepageContext(normalizedSite);
                applyHomepageContextPayload(normalizedSite, payload);
                return homepageContextBySite[normalizedSite];
            })
            .finally(() => {
                homepageContextLoadingBySite[normalizedSite] = null;
            });

        return homepageContextLoadingBySite[normalizedSite];
    }

    function buildHomepagePreviewCard(section, cfg = null) {
        const content = cfg?.content || {};
        const visibleBadge = cfg?.is_visible !== false ? '已显示' : '已隐藏';
        let summary = '';

        switch (section) {
            case 'hero':
                summary = `
                    <strong>${escapeHomepageHtml(getLocalizedHomepageField(content, 'title') || '未配置标题')}</strong>
                    <span>${escapeHomepageHtml(getLocalizedHomepageField(content, 'subtitle') || '未配置副标题')}</span>
                `;
                break;
            case 'prompts':
                const featuredPromptCount = normalizeHomepageFeaturedPromptItems(content.featured_items).length;
                summary = `
                    <strong>${escapeHomepageHtml(getLocalizedHomepageField(content, 'section_title') || 'Prompt 分区')}</strong>
                    <span>${content.enable_auto === false ? `手动精选 · ${featuredPromptCount || 0} 条` : `自动聚合 · ${escapeHomepageHtml(String(content.max_items || 6))} 项 · ${escapeHomepageHtml(content.sort || 'popular')}`}</span>
                `;
                break;
            case 'shop':
                summary = `
                    <strong>${escapeHomepageHtml(getLocalizedHomepageField(content, 'section_title') || '商城分区')}</strong>
                    <span>${content.enable_auto === false ? '手动精选' : '自动聚合'} · ${escapeHomepageHtml(String(content.max_items || 6))} 项 · ${escapeHomepageHtml(content.category || 'all')}</span>
                `;
                break;
            case 'verify':
                summary = `
                    <strong>${escapeHomepageHtml(getLocalizedHomepageField(content, 'section_title') || 'Verify 分区')}</strong>
                    <span>${content.screenshot_path ? '已配置截图' : '缺少截图'} · ${escapeHomepageHtml(String((content.features || []).length || 0))} 个标签</span>
                `;
                break;
            case 'guestbook':
                summary = `
                    <strong>${escapeHomepageHtml(getLocalizedHomepageField(content, 'section_title') || '留言板分区')}</strong>
                    <span>${content.enable_auto === false ? '手动模式' : '自动聚合'} · ${escapeHomepageHtml(String(content.max_items || 6))} 项</span>
                `;
                break;
            case 'ticker':
                summary = `
                    <strong>${escapeHomepageHtml(SV_LABELS.ticker.label)}</strong>
                    <span>Prompt ${content.enable_prompts ? '开' : '关'} / Shop ${content.enable_products ? '开' : '关'} · 速度 ${escapeHomepageHtml(String(content.speed || 30))}</span>
                `;
                break;
            default:
                summary = '<strong>未配置</strong><span>等待配置</span>';
                break;
        }

        return `
            <article class="hp-preview-card">
                <div class="hp-preview-card__head">
                    <span class="hp-preview-card__title">${escapeHomepageHtml(SV_LABELS[section]?.label || section)}</span>
                    <span class="status-badge ${cfg?.is_visible !== false ? 'active' : 'banned'}">${visibleBadge}</span>
                </div>
                <div class="hp-preview-card__body">
                    ${summary}
                </div>
                <div class="hp-preview-card__meta">排序 ${escapeHomepageHtml(String(cfg?.display_order ?? 0))}</div>
            </article>
        `;
    }

    function buildHomepageThemePackChangeSummary(sectionKey, content = {}) {
        const safeContent = content && typeof content === 'object' && !Array.isArray(content) ? content : {};
        switch (sectionKey) {
            case 'hero':
                return safeContent.title || safeContent.subtitle || '更新首屏标题与副标题';
            case 'prompts':
            case 'shop':
            case 'guestbook':
                return safeContent.section_title || safeContent.section_subtitle || '更新分区标题与描述';
            case 'verify':
                return safeContent.section_title || safeContent.cta_text || '更新验证区文案与 CTA';
            case 'ticker':
                return [
                    ...(Array.isArray(safeContent.activity_keywords) ? safeContent.activity_keywords : []),
                    ...(Array.isArray(safeContent.custom_items_top) ? safeContent.custom_items_top : []),
                    ...(Array.isArray(safeContent.custom_items_bottom) ? safeContent.custom_items_bottom : [])
                ].slice(0, 3).join(' / ') || '更新跑马灯内容源';
            default:
                return '更新模块内容';
        }
    }

    function buildHomepageThemePackChangeItems(pack = {}) {
        const sections = pack.sections && typeof pack.sections === 'object' && !Array.isArray(pack.sections)
            ? pack.sections
            : {};
        const sectionKeys = Array.isArray(pack.section_keys) && pack.section_keys.length
            ? pack.section_keys
            : Object.keys(sections);

        return sectionKeys
            .filter((sectionKey) => sections[sectionKey])
            .map((sectionKey) => ({
                key: sectionKey,
                label: SV_LABELS[sectionKey]?.label || sectionKey,
                summary: buildHomepageThemePackChangeSummary(sectionKey, sections[sectionKey])
            }));
    }

    function buildHomepageThemePackSelectedPreview(pack = null) {
        if (!pack) {
            return `
                <div class="hp-theme-pack-active-preview__copy">
                    <strong>未选择主题包</strong>
                    <span>主题包会批量写入首页草稿内容，不会改变页面组件 UI 皮肤。</span>
                </div>
            `;
        }

        const changeItems = buildHomepageThemePackChangeItems(pack);
        return `
            <div class="hp-theme-pack-active-preview__copy">
                <strong>${escapeHomepageHtml(pack.name || '主题包')}</strong>
                <span>${escapeHomepageHtml(pack.description || '应用后会覆盖选中模块的首页草稿内容。')}</span>
            </div>
            <div class="hp-theme-pack-active-preview__changes">
                ${changeItems.length
                ? changeItems.map((item) => `
                    <div class="hp-theme-pack-change">
                        <span>${escapeHomepageHtml(item.label)}</span>
                        <strong>${escapeHomepageHtml(item.summary)}</strong>
                    </div>
                `).join('')
                : '<div class="hp-theme-pack-change"><span>影响范围</span><strong>当前主题包没有可预览的模块内容</strong></div>'}
            </div>
        `;
    }

    function updateHomepageThemePackSelectionState(root = document) {
        const shell = root?.querySelector?.('#hp-ops-shell') || document.getElementById('hp-ops-shell');
        if (!shell) return;

        const selectedPackId = getSelectValue('hp-theme-pack-select');
        const selectedPack = getHomepageContextThemePacks(currentReadSite)
            .find((pack) => String(pack.id || '') === selectedPackId) || null;
        const preview = shell.querySelector('[data-homepage-theme-pack-selected-summary]');
        if (preview) {
            preview.innerHTML = buildHomepageThemePackSelectedPreview(selectedPack);
        }

        shell.querySelectorAll('[data-homepage-theme-pack-card]').forEach((card) => {
            const isSelected = card.getAttribute('data-homepage-theme-pack-card') === selectedPackId;
            card.classList.toggle('is-selected', isSelected);
            const button = card.querySelector('[data-homepage-theme-pack-select]');
            if (button) {
                button.textContent = isSelected ? '已选中' : '选中';
                button.classList.toggle('btn-primary', isSelected);
                button.classList.toggle('btn-secondary', !isSelected);
                button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
            }
        });
    }

    function renderHomepageOpsShell() {
        const module = document.getElementById('module-homepage');
        const tabs = document.getElementById('homepageTabsNav');
        const overviewHost = document.getElementById('hp-overview-shell-host');
        if (!module || !tabs) {
            return;
        }

        let shell = document.getElementById('hp-ops-shell');
        if (!shell) {
            shell = document.createElement('section');
            shell.id = 'hp-ops-shell';
            shell.className = 'hp-ops-shell';
        }

        if (overviewHost) {
            if (shell.parentElement !== overviewHost) {
                overviewHost.appendChild(shell);
            }
        } else if (shell.parentElement !== module) {
            module.insertBefore(shell, tabs);
        }

        const aggregateMode = isHomepageAggregateMode();
        const site = normalizeHomepageSite(currentReadSite);
        const siteLabel = getHomepageSiteLabel(site);
        const previousExperimentSlot = shell.querySelector('#hp-experiment-slot')?.value || HOMEPAGE_EXPERIMENT_SLOT_DEFS[0].value;
        const previousThemePack = shell.querySelector('#hp-theme-pack-select')?.value || '';
        const draftMeta = getHomepageDraftMeta(site);
        const releases = getHomepageReleaseMeta(site);
        const health = getHomepageHealth(site) || { status: 'healthy', errors: [], warnings: [] };
        const context = !aggregateMode ? getHomepageContext(site) : null;
        const analytics = context?.analytics || buildEmptyHomepageAnalyticsFallback();
        const support = context?.orchestration_support || { templates_available: false, schedules_available: false, message: '' };
        const templates = Array.isArray(context?.templates) ? context.templates : [];
        const schedules = Array.isArray(context?.schedules) ? context.schedules : [];
        const experiments = aggregateMode ? [] : getHomepageContextExperiments(site);
        const recommendations = aggregateMode ? { signals: [], items: [] } : getHomepageContextRecommendations(site);
        const alerts = aggregateMode ? { generated_at: '', items: [] } : getHomepageContextAlerts(site);
        const reports = aggregateMode ? { daily: { title: '', lines: [] }, weekly: { title: '', lines: [] } } : getHomepageContextReports(site);
        const themePacks = aggregateMode ? [] : getHomepageContextThemePacks(site);
        const latestRelease = releases[0] || null;
        const rollbackTarget = releases[1] || releases[0] || null;
        const healthItems = [...(health.errors || []), ...(health.warnings || [])].slice(0, 6);
        const analyticsRows = ['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker']
            .map((sectionKey) => ({
                key: sectionKey,
                metrics: analytics?.sections?.[sectionKey] || {}
            }));
        const draftNotice = aggregateMode
            ? ''
            : `<div class="hp-ops-note ${draftMeta?.exists ? 'hp-ops-note--pending' : 'hp-ops-note--active'}">
                    <strong>${draftMeta?.exists ? '当前前台仍显示最近一次发布版本。' : '当前草稿与前台已发布版本同步。'}</strong>
                    <span>${draftMeta?.exists ? '你在这里看到的改动只是草稿，点击“发布当前站点”后首页才会更新。' : '继续编辑后需要重新点击“发布当前站点”，前台才会生效。'}</span>
                </div>`;
        const previewCards = aggregateMode
            ? '<div class="hp-preview-empty">当前是全部站点只读视图。切到 CN 或 INTL 后即可查看草稿预览、发布状态和健康检查。</div>'
            : HOMEPAGE_MANAGED_SECTIONS.map((section) => buildHomepagePreviewCard(section, configCache[section])).join('');
        const previewLanguageOptions = [
            { value: 'zh', label: 'ZH' },
            { value: 'en', label: 'EN' }
        ];
        const previewDeviceOptions = [
            { value: 'desktop', label: 'Desktop' },
            { value: 'mobile', label: 'Mobile' }
        ];
        const templateTypeOptions = [
            { value: 'custom', label: '自定义模板' },
            { value: 'theme_pack', label: '主题包' },
            { value: 'new-arrival', label: '新品上新' },
            { value: 'campaign', label: '活动促销' },
            { value: 'intl-launch', label: '国际站冷启动' },
            { value: 'community', label: '社区活跃' }
        ];
        const templateOptions = [
            { value: '', label: '请选择模板' },
            ...templates.map((template) => ({
                value: String(template.id || ''),
                label: template.name || `模板 #${template.id}`
            }))
        ];
        const experimentOptions = HOMEPAGE_EXPERIMENT_SLOT_DEFS.map((slot) => ({
            value: slot.value,
            label: slot.label
        }));
        const experimentCards = experiments.length
            ? experiments.map((experiment) => `
                <article class="hp-experiment-card">
                    <div class="hp-experiment-card__head">
                        <div>
                            <strong>${escapeHomepageHtml(experiment.name || experiment.field_label || experiment.id || '首页实验')}</strong>
                            <span>${escapeHomepageHtml(experiment.field_label || '')} · ${escapeHomepageHtml(String(experiment.traffic_percent || 50))}% 流量</span>
                        </div>
                        <span class="status-badge ${experiment.winner === 'variant' ? 'active' : (experiment.winner === 'control' ? 'pending' : 'default')}">
                            ${experiment.winner === 'variant' ? '实验胜出' : (experiment.winner === 'control' ? '对照胜出' : '观察中')}
                        </span>
                    </div>
                    <div class="hp-experiment-card__variants">
                        <div class="hp-experiment-card__variant">
                            <span>对照组</span>
                            <strong>${escapeHomepageHtml(experiment.control_preview || '未配置')}</strong>
                            <small>CTR ${escapeHomepageHtml(formatHomepagePercent(experiment.control?.ctr_7d || 0))} · ${escapeHomepageHtml(formatHomepageCount(experiment.control?.clicks_7d || 0))} 点击 / ${escapeHomepageHtml(formatHomepageCount(experiment.control?.impressions_7d || 0))} 曝光</small>
                        </div>
                        <div class="hp-experiment-card__variant">
                            <span>实验组</span>
                            <strong>${escapeHomepageHtml(experiment.variant_preview || '未配置')}</strong>
                            <small>CTR ${escapeHomepageHtml(formatHomepagePercent(experiment.variant?.ctr_7d || 0))} · ${escapeHomepageHtml(formatHomepageCount(experiment.variant?.clicks_7d || 0))} 点击 / ${escapeHomepageHtml(formatHomepageCount(experiment.variant?.impressions_7d || 0))} 曝光</small>
                        </div>
                    </div>
                    <div class="hp-experiment-card__reason">${escapeHomepageHtml(experiment.winner_reason || '暂无实验判断')}</div>
                    <div class="hp-inline-actions">
                        <button type="button" class="btn-sm btn-primary" data-homepage-experiment-apply-winner="${escapeHomepageHtml(String(experiment.id || ''))}" ${experiment.can_promote_winner ? '' : 'disabled'}>应用胜出版本</button>
                        <button type="button" class="btn-sm btn-secondary" data-homepage-experiment-delete="${escapeHomepageHtml(String(experiment.id || ''))}">删除实验</button>
                    </div>
                </article>
            `).join('')
            : '<div class="hp-preview-empty">当前站点还没有运行中的首页实验，可从标题、CTA 或精选清单开始做小步试验。</div>';
        const signalMarkup = (recommendations.signals || []).length
            ? `<div class="hp-signal-list">${(recommendations.signals || []).map((signal) => `
                <span class="hp-signal-chip hp-signal-chip--${escapeHomepageHtml(signal.tone || 'default')}">${escapeHomepageHtml(signal.title || signal.summary || '运营信号')}</span>
            `).join('')}</div>`
            : '<div class="hp-preview-empty">当前没有明显的运营异常信号。</div>';
        const recommendationCards = (recommendations.items || []).length
            ? (recommendations.items || []).map((item) => `
                <article class="hp-recommendation-card">
                    <div class="hp-recommendation-card__head">
                        <strong>${escapeHomepageHtml(item.title || '推荐建议')}</strong>
                        <span>${escapeHomepageHtml(SV_LABELS[item.section]?.label || item.section || '')}</span>
                    </div>
                    <div class="hp-recommendation-card__summary">${escapeHomepageHtml(item.summary || '')}</div>
                    <div class="hp-recommendation-card__reason">${escapeHomepageHtml(item.reason || '')}</div>
                    <div class="hp-inline-actions">
                        <button type="button" class="btn-sm btn-primary" data-homepage-recommendation-apply="${escapeHomepageHtml(String(item.id || ''))}">应用到当前草稿</button>
                    </div>
                </article>
            `).join('')
            : '<div class="hp-preview-empty">当前没有待处理的推荐动作。</div>';
        const alertCards = (alerts.items || []).length
            ? (alerts.items || []).map((alert) => `
                <article class="hp-alert-card hp-alert-card--${escapeHomepageHtml(alert.level || 'info')}">
                    <strong>${escapeHomepageHtml(alert.title || '首页告警')}</strong>
                    <span>${escapeHomepageHtml(alert.summary || '')}</span>
                </article>
            `).join('')
            : '<div class="hp-preview-empty">当前没有首页巡检告警。</div>';
        const themePackOptions = themePacks.length
            ? themePacks.map((pack) => ({
                value: String(pack.id || ''),
                label: pack.name || pack.id || '主题包'
            }))
            : [{ value: '', label: '暂无主题包' }];
        const selectedThemePackId = previousThemePack || themePackOptions[0]?.value || '';
        const selectedThemePack = themePacks.find((pack) => String(pack.id || '') === selectedThemePackId) || null;
        const themePackCards = themePacks.length
            ? themePacks.map((pack) => {
                const packId = String(pack.id || '');
                const isSelected = packId === selectedThemePackId;
                const changeItems = buildHomepageThemePackChangeItems(pack);
                return `
                    <article class="hp-theme-pack-card ${isSelected ? 'is-selected' : ''}" data-homepage-theme-pack-card="${escapeHomepageHtml(packId)}">
                        <div class="hp-theme-pack-card__head">
                            <strong>${escapeHomepageHtml(pack.name || '主题包')}</strong>
                            <span>${escapeHomepageHtml(pack.source === 'template' ? '模板主题包' : '内置主题包')}</span>
                        </div>
                        <div class="hp-theme-pack-card__summary">${escapeHomepageHtml(pack.description || '覆盖多模块首页内容')}</div>
                        <div class="hp-theme-pack-card__sections">
                            ${(Array.isArray(pack.section_keys) ? pack.section_keys : []).map((sectionKey) => `
                                <span class="hp-theme-pack-section-chip">${escapeHomepageHtml(SV_LABELS[sectionKey]?.label || sectionKey)}</span>
                            `).join('')}
                        </div>
                        <div class="hp-theme-pack-card__changes">
                            ${changeItems.slice(0, 3).map((item) => `
                                <div class="hp-theme-pack-change">
                                    <span>${escapeHomepageHtml(item.label)}</span>
                                    <strong>${escapeHomepageHtml(item.summary)}</strong>
                                </div>
                            `).join('') || '<div class="hp-theme-pack-change"><span>影响范围</span><strong>暂无可预览内容</strong></div>'}
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}" data-homepage-theme-pack-select="${escapeHomepageHtml(packId)}" aria-pressed="${isSelected ? 'true' : 'false'}">${isSelected ? '已选中' : '选中'}</button>
                        </div>
                    </article>
                `;
            }).join('')
            : '<div class="hp-preview-empty">当前还没有可套用的主题包。</div>';

        shell.innerHTML = `
            <div class="hp-ops-shell__grid">
                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">发布</div>
                            <strong>${escapeHomepageHtml(siteLabel)}</strong>
                        </div>
                        <span class="status-badge ${aggregateMode ? 'banned' : (draftMeta?.exists ? 'pending' : 'active')}">
                            ${aggregateMode ? '只读对比' : (draftMeta?.exists ? '有草稿' : '已发布同步')}
                        </span>
                    </div>
                    <div class="hp-ops-metrics">
                        <div class="hp-ops-metric">
                            <span>草稿更新时间</span>
                            <strong>${escapeHomepageHtml(formatHomepageTime(draftMeta?.updated_at))}</strong>
                        </div>
                        <div class="hp-ops-metric">
                            <span>最近发布时间</span>
                            <strong>${escapeHomepageHtml(formatHomepageTime(latestRelease?.published_at))}</strong>
                        </div>
                        <div class="hp-ops-metric">
                            <span>回滚目标</span>
                            <strong>${escapeHomepageHtml(rollbackTarget?.id ? `#${rollbackTarget.id}` : '暂无版本')}</strong>
                        </div>
                    </div>
                    <div class="hp-ops-actions">
                        <button type="button" class="btn-sm btn-secondary" id="hp-refresh-config-btn">刷新</button>
                        <button type="button" class="btn-sm btn-secondary" id="hp-rollback-btn" ${aggregateMode || !rollbackTarget?.id ? 'disabled' : ''}>回滚上一版</button>
                        <button type="button" class="btn-sm btn-primary" id="hp-publish-btn" ${aggregateMode ? 'disabled' : ''}>发布当前站点</button>
                    </div>
                    ${draftNotice}
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">预览矩阵</div>
                            <strong>${aggregateMode ? '切站后可预览' : '草稿摘要预览'}</strong>
                        </div>
                        <div class="hp-preview-controls">
                            <label>
                                <span>语言</span>
                                ${buildHomepageCustomSelect({
                                    id: 'hp-preview-language',
                                    value: previewLanguage,
                                    options: previewLanguageOptions,
                                    disabled: aggregateMode,
                                    className: 'hp-custom-select--compact'
                                })}
                            </label>
                            <label>
                                <span>设备</span>
                                ${buildHomepageCustomSelect({
                                    id: 'hp-preview-device',
                                    value: previewDevice,
                                    options: previewDeviceOptions,
                                    disabled: aggregateMode,
                                    className: 'hp-custom-select--compact'
                                })}
                            </label>
                        </div>
                    </div>
                    <div class="hp-preview-grid hp-preview-grid--${escapeHomepageHtml(previewDevice)}">
                        ${previewCards}
                    </div>
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">健康检查</div>
                            <strong>${health.status === 'error' ? '存在阻塞问题' : (health.status === 'warning' ? '存在风险提醒' : '通过')}</strong>
                        </div>
                        <span class="status-badge ${health.status === 'error' ? 'banned' : (health.status === 'warning' ? 'pending' : 'active')}">
                            ${escapeHomepageHtml(String(health.error_count || 0))} 错误 / ${escapeHomepageHtml(String(health.warning_count || 0))} 警告
                        </span>
                    </div>
                    <div class="hp-health-list ${healthItems.length ? '' : 'is-empty'}">
                        ${healthItems.length
                ? healthItems.map((item) => `
                                <div class="hp-health-item hp-health-item--${health.errors?.includes?.(item) ? 'error' : 'warning'}">
                                    <strong>${escapeHomepageHtml(SV_LABELS[item.section]?.label || item.section)}</strong>
                                    <span>${escapeHomepageHtml(item.message || '')}</span>
                                </div>
                            `).join('')
                : '<div class="hp-health-item hp-health-item--healthy"><strong>状态良好</strong><span>当前草稿没有检测到阻塞问题。</span></div>'}
                    </div>
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">运营数据</div>
                            <strong>${aggregateMode ? '切站后查看' : '候选池与效果回流'}</strong>
                        </div>
                        <span class="status-badge ${aggregateMode ? 'banned' : 'active'}">${aggregateMode ? '只读' : '可用'}</span>
                    </div>
                    ${aggregateMode ? '<div class="hp-preview-empty">切换到 CN 或 INTL 后可查看候选 Prompt、商城候选池、留言候选池，以及最近 7 / 30 天首页位表现。</div>' : `
                        <div class="hp-orchestration-summary">
                            ${buildHomepageMetricPill('候选 Prompt', formatHomepageCount(context?.prompt_candidates?.length || 0), 'accent')}
                            ${buildHomepageMetricPill('商城候选', formatHomepageCount(context?.shop_products?.length || 0), 'default')}
                            ${buildHomepageMetricPill('留言候选', formatHomepageCount(context?.guestbook_messages?.length || 0), 'default')}
                            ${buildHomepageMetricPill('模板', formatHomepageCount(templates.length), 'default')}
                        </div>
                        <div class="hp-analytics-module-grid">
                            ${analyticsRows.map(({ key, metrics }) => `
                                <article class="hp-analytics-module-card">
                                    <div class="hp-analytics-module-card__head">
                                        <strong>${escapeHomepageHtml(SV_LABELS[key]?.label || key)}</strong>
                                        <span>7d</span>
                                    </div>
                                    <div class="hp-analytics-module-card__stats">
                                        <span>曝光 ${escapeHomepageHtml(formatHomepageCount(metrics.impressions_7d || 0))}</span>
                                        <span>点击 ${escapeHomepageHtml(formatHomepageCount(metrics.clicks_7d || 0))}</span>
                                        <span>转化 ${escapeHomepageHtml(formatHomepageCount(metrics.conversions_7d || 0))}</span>
                                    </div>
                                </article>
                            `).join('')}
                        </div>
                    `}
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">模板与定时</div>
                            <strong>${aggregateMode ? '切站后可操作' : '活动模板 / 定时发布'}</strong>
                        </div>
                        <span class="status-badge ${(support.templates_available && support.schedules_available) ? 'active' : 'pending'}">
                            ${(support.templates_available && support.schedules_available) ? '可用' : '待迁移'}
                        </span>
                    </div>
                    ${aggregateMode ? '<div class="hp-preview-empty">全部站点视图只展示摘要，不支持创建模板或定时发布。</div>' : `
                        ${support.message ? `<div class="hp-inline-note hp-inline-note--warning"><i class="fas fa-triangle-exclamation"></i><span>${escapeHomepageHtml(support.message)}</span></div>` : ''}
                        <div class="hp-ops-form-grid">
                            <div class="hp-field">
                                <label>模板名称</label>
                                <input type="text" class="config-input" id="hp-template-name" placeholder="新品上新模板">
                            </div>
                            <div class="hp-field">
                                <label>模板类型</label>
                                ${buildHomepageCustomSelect({
                                    id: 'hp-template-type',
                                    value: 'custom',
                                    options: templateTypeOptions,
                                    disabled: !support.templates_available
                                })}
                            </div>
                            <div class="hp-field hp-field-full">
                                <label>模板说明</label>
                                <input type="text" class="config-input" id="hp-template-description" placeholder="从当前草稿生成一个可复用首页模板">
                            </div>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm btn-secondary" id="hp-template-save-btn" ${support.templates_available ? '' : 'disabled'}>保存为模板</button>
                        </div>
                        <div class="hp-ops-form-grid hp-ops-form-grid--compact">
                            <div class="hp-field hp-field-full">
                                <label>套用模板</label>
                                ${buildHomepageCustomSelect({
                                    id: 'hp-template-select',
                                    value: '',
                                    options: templateOptions,
                                    disabled: !templates.length
                                })}
                            </div>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm btn-secondary" id="hp-template-apply-btn" ${(templates.length && support.templates_available) ? '' : 'disabled'}>应用到当前草稿</button>
                        </div>
                        <div class="hp-ops-form-grid">
                            <div class="hp-field">
                                <label>定时名称</label>
                                <input type="text" class="config-input" id="hp-schedule-name" placeholder="春季活动首页">
                            </div>
                            <div class="hp-field">
                                <label>开始时间</label>
                                <input type="datetime-local" class="config-input" id="hp-schedule-starts">
                            </div>
                            <div class="hp-field">
                                <label>结束时间</label>
                                <input type="datetime-local" class="config-input" id="hp-schedule-ends">
                            </div>
                            <div class="hp-field">
                                <label>说明</label>
                                <input type="text" class="config-input" id="hp-schedule-note" placeholder="活动结束后自动回退到发布版">
                            </div>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm btn-primary" id="hp-schedule-create-btn" ${support.schedules_available ? '' : 'disabled'}>创建定时发布</button>
                        </div>
                        <div class="hp-schedule-list ${schedules.length ? '' : 'is-empty'}">
                            ${schedules.length ? schedules.map((schedule) => `
                                <article class="hp-schedule-card">
                                    <div class="hp-schedule-card__head">
                                        <strong>${escapeHomepageHtml(schedule.name || `定时 #${schedule.id}`)}</strong>
                                        <span class="status-badge ${schedule.status === 'scheduled' ? 'active' : 'pending'}">${escapeHomepageHtml(schedule.status || 'scheduled')}</span>
                                    </div>
                                    <div class="hp-schedule-card__meta">
                                        <span>开始 ${escapeHomepageHtml(formatHomepageTime(schedule.starts_at))}</span>
                                        <span>${schedule.ends_at ? `结束 ${escapeHomepageHtml(formatHomepageTime(schedule.ends_at))}` : '无结束时间'}</span>
                                    </div>
                                    ${schedule.note ? `<div class="hp-schedule-card__note">${escapeHomepageHtml(schedule.note)}</div>` : ''}
                                    <div class="hp-inline-actions">
                                        <button type="button" class="btn-sm btn-secondary" data-homepage-schedule-cancel="${escapeHomepageHtml(String(schedule.id || ''))}" ${schedule.status === 'cancelled' ? 'disabled' : ''}>取消定时</button>
                                    </div>
                                </article>
                            `).join('') : '<div class="hp-preview-empty">当前站点还没有已创建的定时任务。</div>'}
                        </div>
                    `}
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">实验</div>
                            <strong>${aggregateMode ? '切站后配置实验' : '关键位小步试验'}</strong>
                        </div>
                        <span class="status-badge ${aggregateMode ? 'banned' : (experiments.length ? 'active' : 'pending')}">
                            ${aggregateMode ? '只读' : `${escapeHomepageHtml(String(experiments.length || 0))} 个实验`}
                        </span>
                    </div>
                    ${aggregateMode ? '<div class="hp-preview-empty">切换到具体站点后，可对 Hero 标题、Verify CTA 和精选清单做轻量实验。</div>' : `
                        <div class="hp-ops-form-grid hp-ops-form-grid--compact">
                            <div class="hp-field">
                                <label>实验槽位</label>
                                ${buildHomepageCustomSelect({
                                    id: 'hp-experiment-slot',
                                    value: previousExperimentSlot,
                                    options: experimentOptions
                                })}
                            </div>
                            <div class="hp-field">
                                <label>实验名称</label>
                                <input type="text" class="config-input" id="hp-experiment-name" placeholder="Hero 标题实验">
                            </div>
                            <div class="hp-field">
                                <label>实验流量</label>
                                <div class="hp-slider-row hp-slider-row--compact">
                                    <input type="range" min="10" max="90" step="5" value="50" id="hp-experiment-traffic">
                                    <span id="hp-experiment-traffic-label">50%</span>
                                </div>
                            </div>
                            <div class="hp-field hp-field-full">
                                <label>当前对照组</label>
                                <div class="hp-inline-note hp-inline-note--muted" id="hp-experiment-control-preview">读取中...</div>
                            </div>
                            <div class="hp-field hp-field-full">
                                <label>实验版本内容</label>
                                <textarea class="config-input hp-multiline-input" id="hp-experiment-variant-input" placeholder=""></textarea>
                                <small class="hp-field-help" id="hp-experiment-variant-hint"></small>
                            </div>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm btn-primary" id="hp-experiment-save-btn">保存实验</button>
                        </div>
                        <div class="hp-experiment-list">
                            ${experimentCards}
                        </div>
                    `}
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">推荐</div>
                            <strong>${aggregateMode ? '切站后查看建议' : '运营信号与替换建议'}</strong>
                        </div>
                        <span class="status-badge ${aggregateMode ? 'banned' : ((recommendations.items || []).length ? 'active' : 'pending')}">
                            ${aggregateMode ? '只读' : `${escapeHomepageHtml(String((recommendations.items || []).length || 0))} 条建议`}
                        </span>
                    </div>
                    ${aggregateMode ? '<div class="hp-preview-empty">切换到具体站点后，可查看 Prompt / Shop / Guestbook 的替换建议。</div>' : `
                        ${signalMarkup}
                        <div class="hp-recommendation-list">
                            ${recommendationCards}
                        </div>
                    `}
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">巡检</div>
                            <strong>${aggregateMode ? '切站后查看日报' : '首页主动提醒与运营日报'}</strong>
                        </div>
                        <span class="status-badge ${aggregateMode ? 'banned' : ((alerts.items || []).length ? 'pending' : 'active')}">
                            ${aggregateMode ? '只读' : `${escapeHomepageHtml(String((alerts.items || []).length || 0))} 条告警`}
                        </span>
                    </div>
                    ${aggregateMode ? '<div class="hp-preview-empty">切换到具体站点后，可查看首页巡检告警、日报和周报摘要。</div>' : `
                        <div class="hp-alert-list">
                            ${alertCards}
                        </div>
                        <div class="hp-report-grid">
                            <article class="hp-report-card">
                                <div class="hp-report-card__head">
                                    <strong>${escapeHomepageHtml(reports.daily?.title || '首页运营日报')}</strong>
                                    <button type="button" class="btn-sm btn-secondary" data-homepage-report-copy="daily">复制日报</button>
                                </div>
                                <div class="hp-report-card__lines">
                                    ${(Array.isArray(reports.daily?.lines) ? reports.daily.lines : []).map((line) => `<span>${escapeHomepageHtml(line)}</span>`).join('') || '<span>暂无日报内容</span>'}
                                </div>
                            </article>
                            <article class="hp-report-card">
                                <div class="hp-report-card__head">
                                    <strong>${escapeHomepageHtml(reports.weekly?.title || '首页运营周报')}</strong>
                                    <button type="button" class="btn-sm btn-secondary" data-homepage-report-copy="weekly">复制周报</button>
                                </div>
                                <div class="hp-report-card__lines">
                                    ${(Array.isArray(reports.weekly?.lines) ? reports.weekly.lines : []).map((line) => `<span>${escapeHomepageHtml(line)}</span>`).join('') || '<span>暂无周报内容</span>'}
                                </div>
                            </article>
                        </div>
                    `}
                </section>

                <section class="hp-ops-card">
                    <div class="hp-ops-card__head">
                        <div>
                            <div class="hp-ops-card__eyebrow">主题包</div>
                            <strong>${aggregateMode ? '切站后套用主题包' : '场景化编排与局部覆盖'}</strong>
                        </div>
                        <span class="status-badge ${aggregateMode ? 'banned' : (themePacks.length ? 'active' : 'pending')}">
                            ${aggregateMode ? '只读' : `${escapeHomepageHtml(String(themePacks.length || 0))} 个主题包`}
                        </span>
                    </div>
                    ${aggregateMode ? '<div class="hp-preview-empty">切换到具体站点后，可一键套用节日活动、新品发布、国际站专题和社区活动主题包。</div>' : `
                        <div class="hp-ops-form-grid hp-ops-form-grid--compact">
                            <div class="hp-field hp-field-full">
                                <label>主题包</label>
                                ${buildHomepageCustomSelect({
                                    id: 'hp-theme-pack-select',
                                    value: selectedThemePackId,
                                    options: themePackOptions,
                                    disabled: !themePacks.length
                                })}
                            </div>
                            <div class="hp-field hp-field-full">
                                <label>选中后会写入的内容</label>
                                <div class="hp-theme-pack-active-preview" data-homepage-theme-pack-selected-summary>
                                    ${buildHomepageThemePackSelectedPreview(selectedThemePack)}
                                </div>
                            </div>
                            <div class="hp-field hp-field-full">
                                <label>应用模块</label>
                                <div class="hp-theme-pack-selector">
                                    ${HOMEPAGE_MANAGED_SECTIONS.map((sectionKey) => `
                                        <label class="hp-theme-pack-selector__item">
                                            <input type="checkbox" data-homepage-theme-pack-section value="${escapeHomepageHtml(sectionKey)}" checked>
                                            <span>${escapeHomepageHtml(SV_LABELS[sectionKey]?.label || sectionKey)}</span>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm btn-primary" id="hp-theme-pack-apply-btn" ${themePacks.length ? '' : 'disabled'}>应用主题包</button>
                        </div>
                        <div class="hp-theme-pack-list">
                            ${themePackCards}
                        </div>
                    `}
                </section>
            </div>
        `;

        bindHomepageCustomSelects(shell);

        shell.querySelector('#hp-refresh-config-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '刷新中...',
                action: () => refreshHomepageOpsConfig()
            });
        });
        shell.querySelector('#hp-preview-language')?.addEventListener('change', (event) => {
            previewLanguage = String(event.target.value || 'zh') === 'en' ? 'en' : 'zh';
            renderHomepageOpsShell();
        });
        shell.querySelector('#hp-preview-device')?.addEventListener('change', (event) => {
            previewDevice = String(event.target.value || 'desktop') === 'mobile' ? 'mobile' : 'desktop';
            renderHomepageOpsShell();
        });
        shell.querySelector('#hp-publish-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '发布中...',
                action: () => publishCurrentHomepageSite()
            });
        });
        shell.querySelector('#hp-rollback-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '回滚中...',
                action: () => rollbackCurrentHomepageSite(rollbackTarget?.id || '')
            });
        });
        shell.querySelector('#hp-template-save-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '保存模板...',
                action: () => saveHomepageTemplateFromCurrentSite()
            });
        });
        shell.querySelector('#hp-template-apply-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '应用模板...',
                action: () => applySelectedHomepageTemplate()
            });
        });
        shell.querySelector('#hp-schedule-create-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '创建中...',
                action: () => createHomepageScheduleForCurrentSite()
            });
        });
        shell.querySelectorAll('[data-homepage-schedule-cancel]').forEach((button) => {
            button.addEventListener('click', (event) => {
                runHomepageOpsActionButton(event.currentTarget, {
                    busyText: '取消中...',
                    action: () => cancelHomepageScheduleForCurrentSite(event.currentTarget.dataset.homepageScheduleCancel || '')
                });
            });
        });
        shell.querySelector('#hp-experiment-slot')?.addEventListener('change', () => {
            renderHomepageExperimentComposer();
        });
        shell.querySelector('#hp-experiment-traffic')?.addEventListener('input', (event) => {
            const label = shell.querySelector('#hp-experiment-traffic-label');
            if (label) {
                label.textContent = `${event.target.value}%`;
            }
        });
        shell.querySelector('#hp-experiment-save-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '保存实验...',
                action: () => saveHomepageExperimentForCurrentSite()
            });
        });
        shell.querySelectorAll('[data-homepage-experiment-apply-winner]').forEach((button) => {
            button.addEventListener('click', (event) => {
                runHomepageOpsActionButton(event.currentTarget, {
                    busyText: '应用中...',
                    action: () => applyHomepageExperimentWinnerForCurrentSite(event.currentTarget.dataset.homepageExperimentApplyWinner || '')
                });
            });
        });
        shell.querySelectorAll('[data-homepage-experiment-delete]').forEach((button) => {
            button.addEventListener('click', (event) => {
                runHomepageOpsActionButton(event.currentTarget, {
                    busyText: '删除中...',
                    action: () => deleteHomepageExperimentFromCurrentSite(event.currentTarget.dataset.homepageExperimentDelete || '')
                });
            });
        });
        shell.querySelectorAll('[data-homepage-recommendation-apply]').forEach((button) => {
            button.addEventListener('click', (event) => {
                runHomepageOpsActionButton(event.currentTarget, {
                    busyText: '应用中...',
                    action: () => applyHomepageRecommendationForCurrentSite(event.currentTarget.dataset.homepageRecommendationApply || '')
                });
            });
        });
        shell.querySelectorAll('[data-homepage-report-copy]').forEach((button) => {
            button.addEventListener('click', (event) => {
                runHomepageOpsActionButton(event.currentTarget, {
                    busyText: '复制中...',
                    action: () => copyHomepageReportToClipboard(event.currentTarget.dataset.homepageReportCopy || 'daily')
                });
            });
        });
        shell.querySelector('#hp-theme-pack-apply-btn')?.addEventListener('click', (event) => {
            runHomepageOpsActionButton(event.currentTarget, {
                busyText: '应用中...',
                action: () => applyHomepageThemePackForCurrentSite()
            });
        });
        shell.querySelector('#hp-theme-pack-select')?.addEventListener('change', () => {
            updateHomepageThemePackSelectionState(shell);
        });
        shell.querySelectorAll('[data-homepage-theme-pack-select]').forEach((button) => {
            button.addEventListener('click', (event) => {
                setHomepageCustomSelectValueById('hp-theme-pack-select', event.currentTarget.dataset.homepageThemePackSelect || '', {
                    dispatchChange: true
                });
            });
        });
        updateHomepageThemePackSelectionState(shell);
        renderHomepageExperimentComposer();
    }

    function renderCurrentSection() {
        if (currentSection === HOMEPAGE_OVERVIEW_SECTION) {
            renderHomepageOpsShell();
            return;
        }
        renderSection(currentSection);
    }

    function getHomepageContextPromptCandidates(site = currentReadSite) {
        return Array.isArray(getHomepageContext(site)?.prompt_candidates)
            ? getHomepageContext(site).prompt_candidates
            : [];
    }

    function hasHomepageShopProductSitePrice(product = {}, site = currentReadSite) {
        const normalizedSite = normalizeHomepageSite(site);
        const priceField = normalizedSite === 'intl' ? 'price_points_intl' : 'price_points';
        const rawPrice = product?.[priceField];
        if (rawPrice === null || rawPrice === undefined || rawPrice === '') {
            return false;
        }
        return Number.isFinite(Number(rawPrice));
    }

    function getHomepageContextShopProducts(site = currentReadSite) {
        const products = Array.isArray(getHomepageContext(site)?.shop_products)
            ? getHomepageContext(site).shop_products
            : [];
        return products.filter((product) => product?.is_active !== false && hasHomepageShopProductSitePrice(product, site));
    }

    function getHomepageContextGuestbookMessages(site = currentReadSite) {
        return Array.isArray(getHomepageContext(site)?.guestbook_messages)
            ? getHomepageContext(site).guestbook_messages
            : [];
    }

    function buildHomepageExperimentControlPreview(slotDef = HOMEPAGE_EXPERIMENT_SLOT_DEFS[0], site = currentReadSite) {
        const content = getHomepageSectionConfigBySite(slotDef.section, site)?.content || buildEmptyHomepageSectionContent(slotDef.section);
        const primaryLang = normalizeHomepageSite(site) === 'intl' ? 'en' : 'zh';

        if (slotDef.field === 'title' || slotDef.field === 'subtitle') {
            return String(content?.[`${slotDef.field}_${primaryLang}`] || content?.[slotDef.field] || '').trim() || '未配置';
        }

        if (slotDef.field === 'cta_text') {
            return String(content?.cta_text || '').trim() || '未配置';
        }

        return buildHomepageListPreview(content?.[slotDef.field], '未配置精选内容');
    }

    function renderHomepageExperimentComposer() {
        const select = document.getElementById('hp-experiment-slot');
        const preview = document.getElementById('hp-experiment-control-preview');
        const variantInput = document.getElementById('hp-experiment-variant-input');
        const hint = document.getElementById('hp-experiment-variant-hint');
        if (!select || !preview || !variantInput || !hint) {
            return;
        }

        const slotDef = getHomepageExperimentSlotDefinition(select.value);
        preview.textContent = buildHomepageExperimentControlPreview(slotDef, currentReadSite);
        variantInput.placeholder = slotDef.placeholder || '';
        hint.textContent = slotDef.inputKind === 'list'
            ? '清单型实验请输入候选 ID，支持逗号或换行分隔；当前对照组会自动取草稿里的首页精选。'
            : '文本型实验会直接覆盖当前站点主语言文案；当前对照组会自动取现有草稿内容。';
    }

    function buildHomepageReportPlainText(report = {}, site = currentReadSite) {
        const title = String(report?.title || '').trim() || `${getHomepageSiteLabel(site)} 首页运营报告`;
        const lines = Array.isArray(report?.lines) ? report.lines : [];
        return [title, ...lines].filter(Boolean).join('\n');
    }

    function renderHomepageHeroEntriesList() {
        const container = document.getElementById('hp-hero-entries-list');
        if (!container) return;

        const content = getHomepageCurrentSectionContent('hero');
        const items = withHomepageRequiredHeroEntries(Array.isArray(content.entries) && content.entries.length
            ? content.entries
            : getHomepageDefaultHeroEntries());

        container.innerHTML = items.map((item, index) => `
            <article class="hp-list-card" data-hero-entry-index="${escapeHomepageHtml(String(index))}" data-hero-entry-id="${escapeHomepageHtml(String(item.id || item.section || item.link || `entry_${index + 1}`))}">
                <div class="hp-list-card__head">
                    <strong>入口 #${escapeHomepageHtml(String(index + 1))}</strong>
                    <div class="hp-list-card__actions">
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-hero-entry" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="up" ${index === 0 ? 'disabled' : ''}>上移</button>
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-hero-entry" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="down" ${index === items.length - 1 ? 'disabled' : ''}>下移</button>
                        <button type="button" class="hp-chip-btn hp-chip-btn--danger" data-homepage-action="remove-hero-entry" data-homepage-index="${escapeHomepageHtml(String(index))}">移除</button>
                    </div>
                </div>
                <div class="hp-inline-checkbox">
                    <label><input type="checkbox" data-hero-entry-field="enabled" ${item.enabled !== false ? 'checked' : ''}> 启用该入口</label>
                </div>
                <div class="hp-form-grid hp-form-grid--compact">
                    <div class="hp-field"><label>文案</label><input type="text" class="config-input" data-hero-entry-field="text" value="${escapeHomepageHtml(item.text || '')}"></div>
                    <div class="hp-field"><label>英文文案</label><input type="text" class="config-input" data-hero-entry-field="text_en" value="${escapeHomepageHtml(item.text_en || '')}"></div>
                    <div class="hp-field"><label>图标</label><input type="text" class="config-input" data-hero-entry-field="icon" value="${escapeHomepageHtml(item.icon || '')}" placeholder="fa-store"></div>
                    <div class="hp-field"><label>颜色</label><input type="text" class="config-input" data-hero-entry-field="color" value="${escapeHomepageHtml(item.color || '')}" placeholder="#60a5fa"></div>
                    <div class="hp-field"><label>跳转链接</label><input type="text" class="config-input" data-hero-entry-field="link" value="${escapeHomepageHtml(item.link || '')}" placeholder="/prompts.html"></div>
                    <div class="hp-field"><label>目标模块</label><input type="text" class="config-input" data-hero-entry-field="section" value="${escapeHomepageHtml(item.section || '')}" placeholder="prompts / shop / verify"></div>
                    <div class="hp-field hp-field-full"><label>点击动作</label><input type="text" class="config-input" data-hero-entry-field="action" value="${escapeHomepageHtml(item.action || '')}" placeholder="openGuestbookModal"></div>
                </div>
            </article>
        `).join('');
    }

    function syncHomepageHeroEntriesFromDom() {
        const container = document.getElementById('hp-hero-entries-list');
        if (!container) return;
        replaceHomepageSectionContent('hero', (content) => {
            const nextEntries = Array.from(container.querySelectorAll('[data-hero-entry-index]')).map((row, index) => ({
                id: String(row.dataset.heroEntryId || content.entries?.[index]?.id || content.entries?.[index]?.section || content.entries?.[index]?.link || `entry_${index + 1}`).trim(),
                text: row.querySelector('[data-hero-entry-field="text"]')?.value?.trim() || '',
                text_en: row.querySelector('[data-hero-entry-field="text_en"]')?.value?.trim() || '',
                icon: row.querySelector('[data-hero-entry-field="icon"]')?.value?.trim() || '',
                color: row.querySelector('[data-hero-entry-field="color"]')?.value?.trim() || '',
                link: row.querySelector('[data-hero-entry-field="link"]')?.value?.trim() || '',
                section: row.querySelector('[data-hero-entry-field="section"]')?.value?.trim() || '',
                action: row.querySelector('[data-hero-entry-field="action"]')?.value?.trim() || '',
                enabled: row.querySelector('[data-hero-entry-field="enabled"]')?.checked !== false
            })).filter((item) => item.text || item.link || item.action);
            content.entries = withHomepageRequiredHeroEntries(nextEntries);
            return content;
        });
    }

    function renderHomepagePromptCandidateList() {
        const container = document.getElementById('hp-prompts-candidate-list');
        if (!container) return;
        if (isHomepageAggregateMode()) {
            container.innerHTML = '<div class="hp-featured-empty">聚合视图不展示候选池，请切换到具体站点。</div>';
            return;
        }

        const candidates = getHomepageContextPromptCandidates(currentReadSite);
        if (!candidates.length) {
            container.innerHTML = '<div class="hp-featured-empty">当前站点暂无首页候选 Prompt。</div>';
            return;
        }

        container.innerHTML = candidates.map((item) => {
            const alreadyFeatured = Array.isArray(item.featured_sites) && item.featured_sites.includes(normalizeHomepageSite(currentReadSite));
            return `
                <article class="hp-candidate-card">
                    <div class="hp-candidate-card__media">
                        ${item.image ? `<img src="${escapeHomepageHtml(item.image)}" alt="${escapeHomepageHtml(item.title || item.id || 'Prompt')}" loading="lazy" decoding="async">` : '<div class="hp-candidate-card__placeholder"></div>'}
                    </div>
                    <div class="hp-candidate-card__body">
                        <strong>${escapeHomepageHtml(item.title || item.title_zh || item.title_en || item.id || '未命名 Prompt')}</strong>
                        <span>${escapeHomepageHtml(item.candidate_reason || '来自候选池')}</span>
                        <div class="hp-candidate-card__meta">
                            <span>推荐人 ${escapeHomepageHtml(item.recommended_by || '运营')}</span>
                            <span>浏览 ${escapeHomepageHtml(formatHomepageCount(item.metrics?.prompt_view_7d || 0))}</span>
                            <span>解锁 ${escapeHomepageHtml(formatHomepageCount(item.metrics?.unlock_success_7d || 0))}</span>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm ${alreadyFeatured ? 'btn-secondary' : 'btn-primary'}" data-homepage-action="add-prompt-candidate" data-homepage-prompt-id="${escapeHomepageHtml(String(item.id || ''))}" ${alreadyFeatured ? 'disabled' : ''}>
                                ${alreadyFeatured ? '已在首页' : '加入首页精选'}
                            </button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderHomepageShopCategoryOptions() {
        const select = document.getElementById('hp-shop-category');
        if (!select) return;
        const currentValue = getHomepageCurrentSectionContent('shop').category || 'all';
        const categories = Array.isArray(getHomepageContext(currentReadSite)?.shop_categories)
            ? getHomepageContext(currentReadSite).shop_categories
            : [];
        const rows = categories
            .map((item) => {
                const name = String(item?.name || '').trim();
                return name ? `<option value="${escapeHomepageHtml(name)}">${escapeHomepageHtml(name)}</option>` : '';
            })
            .filter(Boolean)
            .join('');
        select.innerHTML = `<option value="all">全部分类</option>${rows}`;
        setSelectValue('hp-shop-category', currentValue);
    }

    function renderHomepageShopCuratedList() {
        const container = document.getElementById('hp-shop-curated-list');
        if (!container) return;
        const items = Array.isArray(getHomepageCurrentSectionContent('shop').custom_items)
            ? getHomepageCurrentSectionContent('shop').custom_items
            : [];
        if (!items.length) {
            container.innerHTML = '<div class="hp-featured-empty">当前还没有人工置顶商品，可从下方商城候选池加入。</div>';
            return;
        }

        container.innerHTML = items.map((item, index) => `
            <article class="hp-list-card" data-shop-curated-index="${escapeHomepageHtml(String(index))}">
                <div class="hp-list-card__head">
                    <strong>${escapeHomepageHtml(item.name || item.name_zh || item.name_en || `商品 #${index + 1}`)}</strong>
                    <div class="hp-list-card__actions">
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-shop-curated" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="up" ${index === 0 ? 'disabled' : ''}>上移</button>
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-shop-curated" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="down" ${index === items.length - 1 ? 'disabled' : ''}>下移</button>
                        <button type="button" class="hp-chip-btn hp-chip-btn--danger" data-homepage-action="remove-shop-curated" data-homepage-index="${escapeHomepageHtml(String(index))}">移除</button>
                    </div>
                </div>
                <div class="hp-list-card__meta-row">
                    <span>${escapeHomepageHtml(item.category || '未分类')}</span>
                    <span>${item.is_active === false ? '已下架' : '上架中'}</span>
                    <span>${Number(item.stock_count || 0) > 0 ? `库存 ${escapeHomepageHtml(String(item.stock_count))}` : '库存不足'}</span>
                </div>
                <div class="hp-field">
                    <label>首页角标</label>
                    <input type="text" class="config-input" data-shop-curated-field="badge" value="${escapeHomepageHtml(item.badge || '')}" placeholder="新品 / 热门 / 限时">
                </div>
            </article>
        `).join('');
    }

    function syncHomepageShopCuratedFromDom() {
        const container = document.getElementById('hp-shop-curated-list');
        if (!container) return;
        replaceHomepageSectionContent('shop', (content) => {
            const sourceItems = Array.isArray(content.custom_items) ? content.custom_items : [];
            content.custom_items = Array.from(container.querySelectorAll('[data-shop-curated-index]')).map((row, index) => ({
                ...(sourceItems[index] || {}),
                badge: row.querySelector('[data-shop-curated-field="badge"]')?.value?.trim() || ''
            }));
            return content;
        });
    }

    function renderHomepageShopProductList() {
        const container = document.getElementById('hp-shop-product-list');
        if (!container) return;
        if (isHomepageAggregateMode()) {
            container.innerHTML = '<div class="hp-featured-empty">聚合视图不展示商城候选池，请切换到具体站点。</div>';
            return;
        }

        const currentItems = Array.isArray(getHomepageCurrentSectionContent('shop').custom_items)
            ? getHomepageCurrentSectionContent('shop').custom_items
            : [];
        const selectedIds = new Set(currentItems.map((item) => String(item?.id || '').trim()).filter(Boolean));
        const products = getHomepageContextShopProducts(currentReadSite);
        if (!products.length) {
            container.innerHTML = '<div class="hp-featured-empty">当前站点没有可用商城候选数据。候选池会从“商城商品目录”的已启用、已配置当前站点价格的商品自动生成。</div>';
            return;
        }

        container.innerHTML = products.slice(0, 24).map((item) => {
            const id = String(item?.id || '').trim();
            const disabled = !id || selectedIds.has(id);
            return `
                <article class="hp-candidate-card">
                    <div class="hp-candidate-card__media">
                        ${item.icon_url ? `<img src="${escapeHomepageHtml(item.icon_url)}" alt="${escapeHomepageHtml(item.name || item.name_zh || item.name_en || '商品')}" loading="lazy" decoding="async">` : '<div class="hp-candidate-card__placeholder"></div>'}
                    </div>
                    <div class="hp-candidate-card__body">
                        <strong>${escapeHomepageHtml(item.name || item.name_zh || item.name_en || id || '未命名商品')}</strong>
                        <span>${escapeHomepageHtml(item.category || '未分类')} · ${item.is_active === false ? '已下架' : '上架中'}</span>
                        <div class="hp-candidate-card__meta">
                            <span>${Number(item.stock_count || 0) > 0 ? `库存 ${escapeHomepageHtml(String(item.stock_count))}` : '库存不足'}</span>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm ${disabled ? 'btn-secondary' : 'btn-primary'}" data-homepage-action="add-shop-product" data-homepage-product-id="${escapeHomepageHtml(id)}" ${disabled ? 'disabled' : ''}>${disabled ? '已加入' : '加入人工精选'}</button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderHomepageGuestbookFeaturedList() {
        const container = document.getElementById('hp-guestbook-featured-list');
        if (!container) return;
        const items = Array.isArray(getHomepageCurrentSectionContent('guestbook').featured_items)
            ? getHomepageCurrentSectionContent('guestbook').featured_items
            : [];
        if (!items.length) {
            container.innerHTML = '<div class="hp-featured-empty">当前还没有首页精选留言，可从候选池加入。</div>';
            return;
        }

        container.innerHTML = items.map((item, index) => `
            <article class="hp-list-card" data-guestbook-featured-index="${escapeHomepageHtml(String(index))}">
                <div class="hp-list-card__head">
                    <strong>${escapeHomepageHtml(item.username || item.author || `留言 #${index + 1}`)}</strong>
                    <div class="hp-list-card__actions">
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-guestbook-featured" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="up" ${index === 0 ? 'disabled' : ''}>上移</button>
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-guestbook-featured" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="down" ${index === items.length - 1 ? 'disabled' : ''}>下移</button>
                        <button type="button" class="hp-chip-btn hp-chip-btn--danger" data-homepage-action="remove-guestbook-featured" data-homepage-index="${escapeHomepageHtml(String(index))}">移除</button>
                    </div>
                </div>
                <div class="hp-list-card__content">${escapeHomepageHtml(item.content || '')}</div>
                <div class="hp-field">
                    <label>推荐理由</label>
                    <input type="text" class="config-input" data-guestbook-featured-field="reason" value="${escapeHomepageHtml(item.reason || '')}" placeholder="治愈氛围 / 社区互动高">
                </div>
            </article>
        `).join('');
    }

    function syncHomepageGuestbookFeaturedFromDom() {
        const container = document.getElementById('hp-guestbook-featured-list');
        if (!container) return;
        replaceHomepageSectionContent('guestbook', (content) => {
            const sourceItems = Array.isArray(content.featured_items) ? content.featured_items : [];
            content.featured_items = Array.from(container.querySelectorAll('[data-guestbook-featured-index]')).map((row, index) => ({
                ...(sourceItems[index] || {}),
                reason: row.querySelector('[data-guestbook-featured-field="reason"]')?.value?.trim() || ''
            }));
            return content;
        });
    }

    function renderHomepageGuestbookCandidateList() {
        const container = document.getElementById('hp-guestbook-candidate-list');
        if (!container) return;
        if (isHomepageAggregateMode()) {
            container.innerHTML = '<div class="hp-featured-empty">聚合视图不展示留言候选池，请切换到具体站点。</div>';
            return;
        }

        const currentItems = Array.isArray(getHomepageCurrentSectionContent('guestbook').featured_items)
            ? getHomepageCurrentSectionContent('guestbook').featured_items
            : [];
        const selectedIds = new Set(currentItems.map((item) => String(item?.id || '').trim()).filter(Boolean));
        const messages = getHomepageContextGuestbookMessages(currentReadSite);
        if (!messages.length) {
            container.innerHTML = '<div class="hp-featured-empty">当前没有可用留言候选数据。</div>';
            return;
        }

        container.innerHTML = messages.map((item) => {
            const id = String(item?.id || '').trim();
            const disabled = !id || selectedIds.has(id);
            const username = item?.profiles?.username || item?.username || '匿名用户';
            return `
                <article class="hp-candidate-card hp-candidate-card--text">
                    <div class="hp-candidate-card__body">
                        <strong>${escapeHomepageHtml(username)}</strong>
                        <span>${escapeHomepageHtml(String(item?.content || '').trim().slice(0, 120) || '空留言')}</span>
                        <div class="hp-candidate-card__meta">
                            <span>点赞 ${escapeHomepageHtml(formatHomepageCount(item?.like_count || 0))}</span>
                            <span>${escapeHomepageHtml(formatHomepageTime(item?.created_at))}</span>
                        </div>
                        <div class="hp-inline-actions">
                            <button type="button" class="btn-sm ${disabled ? 'btn-secondary' : 'btn-primary'}" data-homepage-action="add-guestbook-candidate" data-homepage-message-id="${escapeHomepageHtml(id)}" ${disabled ? 'disabled' : ''}>${disabled ? '已加入' : '加入首页精选'}</button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderHomepageGuestbookFallbackList() {
        const container = document.getElementById('hp-guestbook-fallback-list');
        if (!container) return;
        const items = Array.isArray(getHomepageCurrentSectionContent('guestbook').fallback_items)
            ? getHomepageCurrentSectionContent('guestbook').fallback_items
            : [];
        if (!items.length) {
            container.innerHTML = '<div class="hp-featured-empty">当前还没有兜底卡片。</div>';
            return;
        }

        container.innerHTML = items.map((item, index) => `
            <article class="hp-list-card" data-guestbook-fallback-index="${escapeHomepageHtml(String(index))}">
                <div class="hp-list-card__head">
                    <strong>兜底卡片 #${escapeHomepageHtml(String(index + 1))}</strong>
                    <div class="hp-list-card__actions">
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-guestbook-fallback" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="up" ${index === 0 ? 'disabled' : ''}>上移</button>
                        <button type="button" class="hp-chip-btn" data-homepage-action="move-guestbook-fallback" data-homepage-index="${escapeHomepageHtml(String(index))}" data-homepage-direction="down" ${index === items.length - 1 ? 'disabled' : ''}>下移</button>
                        <button type="button" class="hp-chip-btn hp-chip-btn--danger" data-homepage-action="remove-guestbook-fallback" data-homepage-index="${escapeHomepageHtml(String(index))}">移除</button>
                    </div>
                </div>
                <div class="hp-form-grid hp-form-grid--compact">
                    <div class="hp-field hp-field-full"><label>文案</label><textarea class="config-input hp-multiline-input" data-guestbook-fallback-field="content">${escapeHomepageHtml(item.content || '')}</textarea></div>
                    <div class="hp-field"><label>作者</label><input type="text" class="config-input" data-guestbook-fallback-field="author" value="${escapeHomepageHtml(item.author || '')}" placeholder="早鸟社区"></div>
                    <div class="hp-field"><label>头像 URL</label><input type="text" class="config-input" data-guestbook-fallback-field="avatar_url" value="${escapeHomepageHtml(item.avatar_url || '')}" placeholder="https://..."></div>
                </div>
            </article>
        `).join('');
    }

    function syncHomepageGuestbookFallbackFromDom() {
        const container = document.getElementById('hp-guestbook-fallback-list');
        if (!container) return;
        replaceHomepageSectionContent('guestbook', (content) => {
            content.fallback_items = Array.from(container.querySelectorAll('[data-guestbook-fallback-index]')).map((row, index) => ({
                id: String(content.fallback_items?.[index]?.id || `fallback_${index + 1}`).trim(),
                content: row.querySelector('[data-guestbook-fallback-field="content"]')?.value?.trim() || '',
                author: row.querySelector('[data-guestbook-fallback-field="author"]')?.value?.trim() || '',
                avatar_url: row.querySelector('[data-guestbook-fallback-field="avatar_url"]')?.value?.trim() || ''
            })).filter((item) => item.content);
            return content;
        });
    }

    function renderSection(section) {
        const cfg = configCache[section];
        if (!cfg) return;

        const content = cfg.content || {};
        const draftMeta = !isHomepageAggregateMode() ? getHomepageDraftMeta(currentReadSite) : null;
        const autoBar = document.querySelector(`.hp-section-view[data-hp-view="${section}"] .hp-auto-bar`);

        // Common controls
        setToggle(`hp-${section}-visible`, cfg.is_visible);
        setInputValue(`hp-${section}-order`, cfg.display_order);

        // Auto aggregation toggle
        setToggle(`hp-${section}-auto`, content.enable_auto);
        setHomepageAdminHiddenState(autoBar, !['prompts', 'shop', 'guestbook'].includes(section), '');

        // Updated timestamp
        const updatedEl = document.getElementById(`hp-${section}-updated`);
        if (updatedEl) {
            updatedEl.textContent = isHomepageAggregateMode()
                ? `最后更新: ${formatHomepageTime(cfg.updated_at)}`
                : `草稿更新: ${formatHomepageTime(draftMeta?.updated_at || cfg.updated_at)}`;
        }

        // Section-specific fields
        switch (section) {
            case 'hero':
                setInputValue('hp-hero-title', content.title);
                setInputValue('hp-hero-subtitle', content.subtitle);
                setInputValue('hp-hero-custom-image', content.custom_image);
                renderHomepageHeroEntriesList();
                break;

            case 'prompts':
                setInputValue('hp-prompts-title', content.section_title);
                setInputValue('hp-prompts-subtitle', content.section_subtitle);
                setInputValue('hp-prompts-max', content.max_items);
                setSelectValue('hp-prompts-sort', content.sort);
                renderHomepageFeaturedPromptList(getHomepageAdminRouteState().focusPromptId);
                renderHomepagePromptCandidateList();
                break;

            case 'shop':
                setInputValue('hp-shop-title', content.section_title);
                setInputValue('hp-shop-subtitle', content.section_subtitle);
                setInputValue('hp-shop-max', content.max_items);
                renderHomepageShopCategoryOptions();
                setSelectValue('hp-shop-sort', content.sort);
                renderHomepageShopCuratedList();
                renderHomepageShopProductList();
                break;

            case 'verify':
                setInputValue('hp-verify-title', content.section_title);
                setInputValue('hp-verify-subtitle', content.section_subtitle);
                setInputValue('hp-verify-screenshot', content.screenshot_path);
                setInputValue('hp-verify-features', (content.features || []).join(', '));
                setInputValue('hp-verify-value-props', (content.value_props || []).join(', '));
                setInputValue('hp-verify-supported-models', (content.supported_models || []).join(', '));
                setInputValue('hp-verify-cta-text', content.cta_text);
                setInputValue('hp-verify-cta-link', content.cta_link);
                setInputValue('hp-verify-risk-notice', content.risk_notice);
                // Show image preview if path exists
                _updateScreenshotPreview(content.screenshot_path);
                break;

            case 'guestbook':
                setInputValue('hp-guestbook-title', content.section_title);
                setInputValue('hp-guestbook-subtitle', content.section_subtitle);
                setInputValue('hp-guestbook-max', content.max_items);
                renderHomepageGuestbookFeaturedList();
                renderHomepageGuestbookCandidateList();
                renderHomepageGuestbookFallbackList();
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
                setInputValue('hp-ticker-prompt-tags', (content.prompt_tags || []).join('\n'));
                setInputValue('hp-ticker-product-categories', (content.product_categories || []).join('\n'));
                setInputValue('hp-ticker-activity-keywords', (content.activity_keywords || []).join('\n'));
                setInputValue('hp-ticker-custom-top', (content.custom_items_top || []).join('\n'));
                setInputValue('hp-ticker-custom-bottom', (content.custom_items_bottom || []).join('\n'));
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
        const pendingState = getHomepageFeaturedPromptPendingState(currentReadSite);
        const sortLocked = Boolean(pendingState);
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
            const canMoveTop = index > 0;
            const isPendingItem = pendingState?.type === 'move' && pendingState.promptId === item.id;
            const topBusy = isPendingItem && pendingState.direction === 'top';
            const upBusy = isPendingItem && pendingState.direction === 'up';
            const downBusy = isPendingItem && pendingState.direction === 'down';

            return `
                <div class="hp-featured-prompt ${item.id === focusPromptId ? 'is-focused' : ''} ${isPendingItem ? 'is-pending' : ''}" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}">
                    <div class="hp-featured-prompt__rank">#${escapeHomepageHtml(String(index + 1))}</div>
                    ${thumb}
                    <div class="hp-featured-prompt__meta">
                        <div class="hp-featured-prompt__title">${escapeHomepageHtml(title)}</div>
                        <div class="hp-featured-prompt__sub">${escapeHomepageHtml(tagLine)}</div>
                    </div>
                    <div class="hp-featured-prompt__actions">
                        <div class="hp-featured-prompt__sort">
                            <button class="hp-featured-prompt__sort-btn ${topBusy ? 'is-busy' : ''}" type="button" ${(canMoveTop && !sortLocked) ? '' : 'disabled'} data-admin-action="homepage-move-featured-prompt" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-direction="top">
                                ${topBusy ? '置顶中...' : '置顶'}
                            </button>
                            <button class="hp-featured-prompt__sort-btn ${upBusy ? 'is-busy' : ''}" type="button" ${(canMoveUp && !sortLocked) ? '' : 'disabled'} data-admin-action="homepage-move-featured-prompt" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-direction="up">
                                ${upBusy ? '上移中...' : '上移'}
                            </button>
                            <button class="hp-featured-prompt__sort-btn ${downBusy ? 'is-busy' : ''}" type="button" ${(canMoveDown && !sortLocked) ? '' : 'disabled'} data-admin-action="homepage-move-featured-prompt" data-homepage-prompt-id="${escapeHomepageHtml(item.id)}" data-homepage-direction="down">
                                ${downBusy ? '下移中...' : '下移'}
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

    function buildHomepageSectionCache(rows = []) {
        return (Array.isArray(rows) ? rows : []).reduce((accumulator, row) => {
            const record = buildHomepageConfigRecord(row);
            if (!record.section) {
                return accumulator;
            }
            accumulator[record.section] = record;
            return accumulator;
        }, {});
    }

    function applyHomepageResponsePayload(site, payload = {}) {
        const normalizedSite = normalizeHomepageSite(site);
        if (normalizedSite === 'all') {
            return;
        }

        if (Array.isArray(payload.rows)) {
            configCacheBySite[normalizedSite] = buildHomepageSectionCache(payload.rows);
        }

        if (Array.isArray(payload.published_rows)) {
            publishedConfigCacheBySite[normalizedSite] = buildHomepageSectionCache(payload.published_rows);
        } else if (!Object.keys(publishedConfigCacheBySite[normalizedSite] || {}).length && Array.isArray(payload.rows)) {
            publishedConfigCacheBySite[normalizedSite] = buildHomepageSectionCache(payload.rows);
        }

        homepageDraftMetaBySite[normalizedSite] = payload.draft || null;
        homepageReleaseMetaBySite[normalizedSite] = Array.isArray(payload.releases) ? payload.releases : [];
        homepageHealthBySite[normalizedSite] = payload.health || null;
        applyHomepageConfigForSite(getHomepageReadSite());
    }

    // ============================================
    // SAVE
    // ============================================

    async function saveHomepageFeaturedPromptItems(items, { site, successMessage = '首页精选 Prompt 已更新', focusPromptId = '', renderStrategy = 'prompts-only', preserveScrollTop = null } = {}) {
        const normalizedSite = normalizeHomepageSite(site);
        const cfg = getHomepageSectionConfigBySite('prompts', normalizedSite);
        if (!cfg) {
            throw new Error(`缺少 ${normalizedSite.toUpperCase()} 站 prompts 区块配置，无法保存首页精选`);
        }
        const featuredListScrollTop = preserveScrollTop == null
            ? (document.getElementById('hp-prompts-featured-list')?.scrollTop || 0)
            : preserveScrollTop;

        const content = {
            ...(cfg.content || {}),
            enable_auto: false,
            featured_items: normalizeHomepageFeaturedPromptItems(items)
        };

        const result = await saveHomepageDraftRow({
            section: 'prompts',
            site: normalizedSite,
            content,
            is_visible: cfg.is_visible,
            display_order: cfg.display_order
        });
        const savedRow = result.row || {};

        applyHomepageResponsePayload(normalizedSite, result);
        invalidateHomepageRuntimeCaches(normalizedSite);
        invalidateSectionVisibilityCaches();
        if (renderStrategy === 'prompts-only') {
            renderHomepageOpsShell();
            renderSection('prompts');
        } else {
            renderAllSections();
        }
        restoreHomepageFeaturedPromptListScroll(featuredListScrollTop);
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
        const normalizedDirection = String(direction || '').trim().toLowerCase();
        const actionLabel = normalizedDirection === 'top'
            ? '置顶首页精选 Prompt'
            : (normalizedDirection === 'up' ? '上移首页精选 Prompt' : '下移首页精选 Prompt');
        const writableSite = options.site || requireWritableHomepageSite({
            label: actionLabel
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

        const nextIndex = normalizedDirection === 'top'
            ? 0
            : (normalizedDirection === 'up' ? currentIndex - 1 : currentIndex + 1);
        if (nextIndex < 0 || nextIndex >= existingItems.length) {
            return false;
        }
        if (nextIndex === currentIndex) {
            return false;
        }

        const nextItems = [...existingItems];
        const [movedItem] = nextItems.splice(currentIndex, 1);
        nextItems.splice(nextIndex, 0, movedItem);
        const listScrollTop = normalizedDirection === 'top'
            ? 0
            : (document.getElementById('hp-prompts-featured-list')?.scrollTop || 0);

        setHomepageFeaturedPromptPendingState({
            type: 'move',
            site: writableSite,
            promptId: movedItem.id,
            direction: normalizedDirection
        });
        setHomepageFeaturedPromptItemsForSite(writableSite, nextItems);
        syncHomepageAdminRouteState({
            section: 'prompts',
            focusPromptId: movedItem.id
        });
        renderHomepageFeaturedPromptList(movedItem.id);
        restoreHomepageFeaturedPromptListScroll(listScrollTop);

        try {
            await saveHomepageFeaturedPromptItems(nextItems, {
                site: writableSite,
                successMessage: normalizedDirection === 'top' ? '已置顶首页精选 Prompt' : '首页精选 Prompt 顺序已更新',
                focusPromptId: movedItem.id,
                renderStrategy: 'prompts-only',
                preserveScrollTop: listScrollTop
            });
            setHomepageFeaturedPromptPendingState(null);
            renderHomepageFeaturedPromptList(movedItem.id);
            restoreHomepageFeaturedPromptListScroll(listScrollTop);
            return true;
        } catch (error) {
            console.error('[Homepage] Move featured prompt failed:', error);
            setHomepageFeaturedPromptItemsForSite(writableSite, existingItems);
            setHomepageFeaturedPromptPendingState(null);
            renderHomepageFeaturedPromptList(promptId);
            restoreHomepageFeaturedPromptListScroll(listScrollTop);
            if (typeof showToast === 'function') {
                showToast(`排序更新失败: ${error.message}`, 'error');
            }
            return false;
        }
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

        if (section === 'hero') {
            syncHomepageHeroEntriesFromDom();
        } else if (section === 'shop') {
            syncHomepageShopCuratedFromDom();
        } else if (section === 'guestbook') {
            syncHomepageGuestbookFeaturedFromDom();
            syncHomepageGuestbookFallbackFromDom();
        }

        switch (section) {
            case 'hero':
                content.title = getInputValue('hp-hero-title');
                content.subtitle = getInputValue('hp-hero-subtitle');
                delete content.cta;
                content.custom_image = getInputValue('hp-hero-custom-image');
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
                content.features = parseHomepageDelimitedList(getInputValue('hp-verify-features'));
                content.value_props = parseHomepageDelimitedList(getInputValue('hp-verify-value-props'));
                content.supported_models = parseHomepageDelimitedList(getInputValue('hp-verify-supported-models'));
                content.cta_text = getInputValue('hp-verify-cta-text');
                content.cta_link = getInputValue('hp-verify-cta-link');
                content.risk_notice = getInputValue('hp-verify-risk-notice');
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
                content.prompt_tags = parseHomepageDelimitedList(getInputValue('hp-ticker-prompt-tags'));
                content.product_categories = parseHomepageDelimitedList(getInputValue('hp-ticker-product-categories'));
                content.activity_keywords = parseHomepageDelimitedList(getInputValue('hp-ticker-activity-keywords'));
                content.custom_items_top = parseHomepageDelimitedList(getInputValue('hp-ticker-custom-top'));
                content.custom_items_bottom = parseHomepageDelimitedList(getInputValue('hp-ticker-custom-bottom'));
                break;
        }

        cfg.content = content;

        // Save draft
        try {
            const result = await saveHomepageDraftRow({
                section,
                site: writableSite,
                content,
                is_visible: cfg.is_visible,
                display_order: cfg.display_order
            });
            const savedRow = result.row || {};
            applyHomepageResponsePayload(writableSite, result);

            const updatedEl = document.getElementById(`hp-${section}-updated`);
            if (updatedEl) {
                updatedEl.textContent = `草稿更新: ${formatHomepageTime(result.draft?.updated_at || savedRow.updated_at || new Date().toISOString())}`;
            }

            // Show save indicator
            const indicator = document.getElementById(`hp-${section}-save-indicator`);
            if (indicator) {
                showHomepageSaveIndicator(indicator, 2000);
            }

            invalidateHomepageRuntimeCaches(writableSite);
            invalidateSectionVisibilityCaches();
            renderAllSections();

            if (typeof showToast === 'function') {
                showToast('草稿已保存', 'success');
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

    async function publishCurrentHomepageSite() {
        const writableSite = requireWritableHomepageSite({ label: '发布首页草稿' });
        if (!writableSite) {
            return false;
        }

        try {
            const result = await publishHomepageDraft(writableSite);
            applyHomepageResponsePayload(writableSite, result);
            invalidateHomepageRuntimeCaches(writableSite);
            invalidateSectionVisibilityCaches();
            renderAllSections();

            if (typeof showToast === 'function') {
                showToast('首页草稿已发布', 'success');
            }

            return true;
        } catch (error) {
            console.error('[Homepage] Publish failed:', error);
            if (typeof showToast === 'function') {
                showToast(`发布失败: ${error.message}`, 'error');
            }
            return false;
        }
    }

    async function rollbackCurrentHomepageSite(releaseId = '') {
        const writableSite = requireWritableHomepageSite({ label: '回滚首页版本' });
        if (!writableSite) {
            return false;
        }

        try {
            const result = await rollbackHomepageDraft(writableSite, releaseId);
            applyHomepageResponsePayload(writableSite, result);
            invalidateHomepageRuntimeCaches(writableSite);
            invalidateSectionVisibilityCaches();
            renderAllSections();

            if (typeof showToast === 'function') {
                showToast('首页已回滚到上一版', 'success');
            }

            return true;
        } catch (error) {
            console.error('[Homepage] Rollback failed:', error);
            if (typeof showToast === 'function') {
                showToast(`回滚失败: ${error.message}`, 'error');
            }
            return false;
        }
    }

    async function refreshHomepageSiteState(site = getHomepageReadSite(), options = {}) {
        const normalizedSite = normalizeHomepageSite(site);
        await ensureHomepageConfigLoaded({ force: true });
        if (!options.skipContext && normalizedSite !== 'all') {
            try {
                await ensureHomepageContextLoaded(normalizedSite, { force: true });
            } catch (error) {
                console.warn('[Homepage] Failed to refresh orchestration context:', error);
            }
        }
        renderAllSections();
        renderCurrentSection();
        return true;
    }

    async function saveHomepageTemplateFromCurrentSite() {
        const writableSite = requireWritableHomepageSite({ label: '保存首页模板' });
        if (!writableSite) {
            return false;
        }

        const name = getInputValue('hp-template-name');
        const description = getInputValue('hp-template-description');
        const templateType = getSelectValue('hp-template-type') || 'custom';
        if (!name) {
            throw new Error('请先填写模板名称');
        }

        const payload = await requestHomepageContextMutation({
            action: 'save_template',
            site: writableSite,
            name,
            description,
            template_type: templateType
        });
        applyHomepageContextPayload(writableSite, payload);
        await refreshHomepageSiteState(writableSite);
        if (typeof showToast === 'function') {
            showToast('首页模板已保存', 'success');
        }
        return true;
    }

    async function applySelectedHomepageTemplate() {
        const writableSite = requireWritableHomepageSite({ label: '应用首页模板' });
        if (!writableSite) {
            return false;
        }
        const templateId = Number.parseInt(getSelectValue('hp-template-select'), 10);
        if (!Number.isFinite(templateId)) {
            throw new Error('请先选择一个模板');
        }

        const payload = await requestHomepageContextMutation({
            action: 'apply_template',
            site: writableSite,
            template_id: templateId
        });
        applyHomepageContextPayload(writableSite, payload);
        await refreshHomepageSiteState(writableSite);
        if (typeof showToast === 'function') {
            showToast('模板已应用到当前草稿', 'success');
        }
        return true;
    }

    async function createHomepageScheduleForCurrentSite() {
        const writableSite = requireWritableHomepageSite({ label: '创建首页定时发布' });
        if (!writableSite) {
            return false;
        }

        const name = getInputValue('hp-schedule-name') || '首页定时发布';
        const note = getInputValue('hp-schedule-note');
        const startsAt = parseHomepageLocalDatetimeToIso(getInputValue('hp-schedule-starts'));
        const endsAt = parseHomepageLocalDatetimeToIso(getInputValue('hp-schedule-ends'));
        if (!startsAt) {
            throw new Error('请先选择开始时间');
        }

        const payload = await requestHomepageContextMutation({
            action: 'schedule_publish',
            site: writableSite,
            name,
            note,
            starts_at: startsAt,
            ends_at: endsAt || undefined
        });
        applyHomepageContextPayload(writableSite, payload);
        if (payload.health) {
            homepageHealthBySite[normalizeHomepageSite(writableSite)] = payload.health;
        }
        renderAllSections();
        if (typeof showToast === 'function') {
            showToast('首页定时发布已创建', 'success');
        }
        return true;
    }

    async function cancelHomepageScheduleForCurrentSite(scheduleId = '') {
        const writableSite = requireWritableHomepageSite({ label: '取消首页定时发布' });
        if (!writableSite) {
            return false;
        }

        const numericId = Number.parseInt(scheduleId, 10);
        if (!Number.isFinite(numericId)) {
            throw new Error('schedule_id 无效');
        }

        const payload = await requestHomepageContextMutation({
            action: 'cancel_schedule',
            site: writableSite,
            schedule_id: numericId
        });
        applyHomepageContextPayload(writableSite, payload);
        renderAllSections();
        if (typeof showToast === 'function') {
            showToast('定时发布已取消', 'success');
        }
        return true;
    }

    async function saveHomepageExperimentForCurrentSite() {
        const writableSite = requireWritableHomepageSite({ label: '保存首页实验' });
        if (!writableSite) {
            return false;
        }

        const slotDef = getHomepageExperimentSlotDefinition(getSelectValue('hp-experiment-slot'));
        const name = getInputValue('hp-experiment-name') || `${slotDef.label} 轻量实验`;
        const trafficPercent = Number.parseInt(getInputValue('hp-experiment-traffic'), 10) || 50;
        const variantInput = getInputValue('hp-experiment-variant-input');
        if (!variantInput) {
            throw new Error('请先填写实验版本内容');
        }

        const payload = await requestHomepageContextMutation({
            action: 'save_experiment',
            site: writableSite,
            section: slotDef.section,
            field: slotDef.field,
            name,
            traffic_percent: trafficPercent,
            variant_input: variantInput
        });
        applyHomepageContextPayload(writableSite, payload);
        await refreshHomepageSiteState(writableSite);
        if (typeof showToast === 'function') {
            showToast('首页实验已保存到当前草稿', 'success');
        }
        return true;
    }

    async function deleteHomepageExperimentFromCurrentSite(experimentId = '') {
        const writableSite = requireWritableHomepageSite({ label: '删除首页实验' });
        if (!writableSite) {
            return false;
        }

        const payload = await requestHomepageContextMutation({
            action: 'delete_experiment',
            site: writableSite,
            experiment_id: experimentId
        });
        applyHomepageContextPayload(writableSite, payload);
        await refreshHomepageSiteState(writableSite);
        if (typeof showToast === 'function') {
            showToast('首页实验已移除', 'success');
        }
        return true;
    }

    async function applyHomepageExperimentWinnerForCurrentSite(experimentId = '') {
        const writableSite = requireWritableHomepageSite({ label: '应用首页实验胜出版本' });
        if (!writableSite) {
            return false;
        }

        const payload = await requestHomepageContextMutation({
            action: 'apply_experiment_winner',
            site: writableSite,
            experiment_id: experimentId
        });
        applyHomepageContextPayload(writableSite, payload);
        await refreshHomepageSiteState(writableSite);
        if (typeof showToast === 'function') {
            showToast('实验胜出版本已写入当前草稿', 'success');
        }
        return true;
    }

    async function applyHomepageRecommendationForCurrentSite(recommendationId = '') {
        const writableSite = requireWritableHomepageSite({ label: '应用首页推荐建议' });
        if (!writableSite) {
            return false;
        }

        const payload = await requestHomepageContextMutation({
            action: 'apply_recommendation',
            site: writableSite,
            recommendation_id: recommendationId
        });
        applyHomepageContextPayload(writableSite, payload);
        await refreshHomepageSiteState(writableSite);
        if (typeof showToast === 'function') {
            showToast('推荐动作已应用到当前草稿', 'success');
        }
        return true;
    }

    async function applyHomepageThemePackForCurrentSite(packId = '') {
        const writableSite = requireWritableHomepageSite({ label: '应用首页主题包' });
        if (!writableSite) {
            return false;
        }

        const selectedPackId = packId || getSelectValue('hp-theme-pack-select');
        if (!selectedPackId) {
            throw new Error('请先选择一个主题包');
        }

        const sectionKeys = Array.from(document.querySelectorAll('[data-homepage-theme-pack-section]'))
            .filter((checkbox) => checkbox.checked)
            .map((checkbox) => checkbox.value);

        const payload = await requestHomepageContextMutation({
            action: 'apply_theme_pack',
            site: writableSite,
            pack_id: selectedPackId,
            section_keys: sectionKeys
        });
        applyHomepageContextPayload(writableSite, payload);
        await refreshHomepageSiteState(writableSite);
        if (typeof showToast === 'function') {
            showToast('主题包已应用到当前草稿', 'success');
        }
        return true;
    }

    async function copyHomepageReportToClipboard(reportKey = 'daily') {
        const reports = getHomepageContextReports(currentReadSite);
        const report = reportKey === 'weekly' ? reports.weekly : reports.daily;
        const text = buildHomepageReportPlainText(report, currentReadSite);
        if (!text) {
            throw new Error('当前没有可复制的报告内容');
        }

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            throw new Error('当前环境不支持剪贴板复制');
        }

        if (typeof showToast === 'function') {
            showToast(`${reportKey === 'weekly' ? '周报' : '日报'}已复制到剪贴板`, 'success');
        }
        return true;
    }

    // ============================================
    // TAB SWITCHING
    // ============================================

    function switchSection(section) {
        currentSection = normalizeHomepageAdminSection(section, currentSection || HOMEPAGE_DEFAULT_SECTION);
        renderCurrentSection();
        syncHomepageAdminRouteState({
            section: currentSection,
            focusPromptId: currentSection === 'prompts' ? getHomepageAdminRouteState().focusPromptId : ''
        }, {
            ensureHomepageModule: true
        });

        // Update tab active state
        const tabNav = document.getElementById('homepageTabsNav');
        if (tabNav) {
            tabNav.querySelectorAll('.admin-tab').forEach(tab => {
                tab.classList.toggle('active', tab.getAttribute('data-hp-section') === currentSection);
            });

            // Move tab indicator
            const activeTab = tabNav.querySelector(`.admin-tab[data-hp-section="${currentSection}"]`);
            if (activeTab && typeof window.updateAdminTabIndicator === 'function') {
                window.updateAdminTabIndicator(activeTab);
            }
        }

        // Show/hide section views
        document.querySelectorAll('.hp-section-view').forEach(view => {
            const isActive = view.getAttribute('data-hp-view') === currentSection;
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

    function moveHomepageListItem(items = [], index = 0, direction = 'up') {
        const currentIndex = Number(index);
        if (!Array.isArray(items) || !Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= items.length) {
            return [...(Array.isArray(items) ? items : [])];
        }
        const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= items.length) {
            return [...items];
        }
        const nextItems = [...items];
        const [item] = nextItems.splice(currentIndex, 1);
        nextItems.splice(nextIndex, 0, item);
        return nextItems;
    }

    function addHomepageHeroEntry() {
        syncHomepageHeroEntriesFromDom();
        replaceHomepageSectionContent('hero', (content) => {
            const sourceEntries = Array.isArray(content.entries) ? content.entries : [];
            const defaultEntry = getHomepageDefaultHeroEntries().find((entry) => !sourceEntries.some((item) => item.id === entry.id))
                || { id: `entry_${sourceEntries.length + 1}`, text: `入口 ${sourceEntries.length + 1}`, text_en: `Entry ${sourceEntries.length + 1}`, icon: 'fa-star', color: '#94a3b8', link: '#', section: '' };
            content.entries = [...sourceEntries, { ...defaultEntry }];
            return content;
        });
        renderHomepageHeroEntriesList();
    }

    function moveHomepageHeroEntry(index, direction) {
        syncHomepageHeroEntriesFromDom();
        replaceHomepageSectionContent('hero', (content) => {
            content.entries = moveHomepageListItem(Array.isArray(content.entries) ? content.entries : [], index, direction);
            return content;
        });
        renderHomepageHeroEntriesList();
    }

    function removeHomepageHeroEntry(index) {
        syncHomepageHeroEntriesFromDom();
        replaceHomepageSectionContent('hero', (content) => {
            content.entries = (Array.isArray(content.entries) ? content.entries : []).filter((_, itemIndex) => itemIndex !== Number(index));
            return content;
        });
        renderHomepageHeroEntriesList();
    }

    async function addHomepagePromptCandidate(promptId = '') {
        const candidate = getHomepageContextPromptCandidates(currentReadSite)
            .find((item) => String(item?.id || '').trim() === String(promptId || '').trim());
        if (!candidate) {
            throw new Error('未找到对应的 Prompt 候选项');
        }
        await addFeaturedPrompt({
            id: candidate.id,
            title: candidate.title || candidate.title_zh || candidate.title_en || candidate.id,
            title_zh: candidate.title_zh || candidate.title || '',
            title_en: candidate.title_en || candidate.title || '',
            images: candidate.image ? [candidate.image] : [],
            tags: Array.isArray(candidate.tags) ? candidate.tags : []
        }, { site: currentReadSite });
    }

    function addHomepageShopProduct(productId = '') {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) return;
        syncHomepageShopCuratedFromDom();
        const product = getHomepageContextShopProducts(currentReadSite).find((item) => String(item?.id || '').trim() === normalizedProductId);
        if (!product) return;
        replaceHomepageSectionContent('shop', (content) => {
            const currentItems = Array.isArray(content.custom_items) ? content.custom_items : [];
            const deduped = currentItems.filter((item) => String(item?.id || '').trim() !== normalizedProductId);
            content.custom_items = [{ ...product, badge: '' }, ...deduped];
            return content;
        });
        renderHomepageShopCuratedList();
        renderHomepageShopProductList();
    }

    function moveHomepageShopCurated(index, direction) {
        syncHomepageShopCuratedFromDom();
        replaceHomepageSectionContent('shop', (content) => {
            content.custom_items = moveHomepageListItem(Array.isArray(content.custom_items) ? content.custom_items : [], index, direction);
            return content;
        });
        renderHomepageShopCuratedList();
        renderHomepageShopProductList();
    }

    function removeHomepageShopCurated(index) {
        syncHomepageShopCuratedFromDom();
        replaceHomepageSectionContent('shop', (content) => {
            content.custom_items = (Array.isArray(content.custom_items) ? content.custom_items : []).filter((_, itemIndex) => itemIndex !== Number(index));
            return content;
        });
        renderHomepageShopCuratedList();
        renderHomepageShopProductList();
    }

    function addHomepageGuestbookCandidate(messageId = '') {
        const normalizedId = String(messageId || '').trim();
        if (!normalizedId) return;
        syncHomepageGuestbookFeaturedFromDom();
        const message = getHomepageContextGuestbookMessages(currentReadSite).find((item) => String(item?.id || '').trim() === normalizedId);
        if (!message) return;
        replaceHomepageSectionContent('guestbook', (content) => {
            const currentItems = Array.isArray(content.featured_items) ? content.featured_items : [];
            const nextItem = {
                id: normalizedId,
                content: String(message?.content || '').trim(),
                image_url: String(message?.image_url || '').trim(),
                like_count: Number(message?.like_count || 0) || 0,
                created_at: message?.created_at || null,
                user_id: message?.user_id || null,
                username: message?.profiles?.username || '',
                avatar_url: message?.profiles?.avatar_url || '',
                reason: ''
            };
            content.featured_items = [nextItem, ...currentItems.filter((item) => String(item?.id || '').trim() !== normalizedId)];
            return content;
        });
        renderHomepageGuestbookFeaturedList();
        renderHomepageGuestbookCandidateList();
    }

    function moveHomepageGuestbookFeatured(index, direction) {
        syncHomepageGuestbookFeaturedFromDom();
        replaceHomepageSectionContent('guestbook', (content) => {
            content.featured_items = moveHomepageListItem(Array.isArray(content.featured_items) ? content.featured_items : [], index, direction);
            return content;
        });
        renderHomepageGuestbookFeaturedList();
        renderHomepageGuestbookCandidateList();
    }

    function removeHomepageGuestbookFeatured(index) {
        syncHomepageGuestbookFeaturedFromDom();
        replaceHomepageSectionContent('guestbook', (content) => {
            content.featured_items = (Array.isArray(content.featured_items) ? content.featured_items : []).filter((_, itemIndex) => itemIndex !== Number(index));
            return content;
        });
        renderHomepageGuestbookFeaturedList();
        renderHomepageGuestbookCandidateList();
    }

    function addHomepageGuestbookFallback() {
        syncHomepageGuestbookFallbackFromDom();
        replaceHomepageSectionContent('guestbook', (content) => {
            const items = Array.isArray(content.fallback_items) ? content.fallback_items : [];
            content.fallback_items = [...items, {
                id: `fallback_${items.length + 1}`,
                content: '',
                author: '',
                avatar_url: ''
            }];
            return content;
        });
        renderHomepageGuestbookFallbackList();
    }

    function moveHomepageGuestbookFallback(index, direction) {
        syncHomepageGuestbookFallbackFromDom();
        replaceHomepageSectionContent('guestbook', (content) => {
            content.fallback_items = moveHomepageListItem(Array.isArray(content.fallback_items) ? content.fallback_items : [], index, direction);
            return content;
        });
        renderHomepageGuestbookFallbackList();
    }

    function removeHomepageGuestbookFallback(index) {
        syncHomepageGuestbookFallbackFromDom();
        replaceHomepageSectionContent('guestbook', (content) => {
            content.fallback_items = (Array.isArray(content.fallback_items) ? content.fallback_items : []).filter((_, itemIndex) => itemIndex !== Number(index));
            return content;
        });
        renderHomepageGuestbookFallbackList();
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
            if (el.dataset.homepageCustomSelectValue === '1') {
                setHomepageCustomSelectValueById(id, value, { dispatchChange: false });
                return;
            }
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
            prompts: 'prompts',
            shop: 'shop',
            verify: 'verify',
            guestbook: 'guestbook',
            ticker: 'ticker'
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
            prompts: 'prompts',
            shop: 'shop',
            verify: 'verify',
            guestbook: 'guestbook',
            ticker: 'ticker'
        };

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
    }

    function renderFooterVisibilityToggle(siteLabel) {
        return siteLabel;
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
        if (!cfg) {
            throw new Error(`缺少 ${hpSection} 区块配置，无法保存显示状态`);
        }

        const previousValue = cfg.is_visible !== false;
        cfg.is_visible = checked;
        setToggle(`hp-${hpSection}-visible`, checked);

        try {
            const result = await saveHomepageDraftRow({
                section: hpSection,
                site,
                is_visible: checked
            });
            applyHomepageResponsePayload(site, result);
            const updatedEl = document.getElementById(`hp-${hpSection}-updated`);
            if (updatedEl) {
                updatedEl.textContent = `草稿更新: ${formatHomepageTime(result.draft?.updated_at || new Date().toISOString())}`;
            }

            invalidateHomepageRuntimeCaches(site);
            invalidateSectionVisibilityCaches();
            renderAllSections();

            if (typeof showToast === 'function') {
                showToast('分栏草稿已保存', 'success');
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

        const homepageModule = document.getElementById('module-homepage');
        bindHomepageNestedScrollBridge(homepageModule);
        if (homepageModule && homepageModule.dataset.homepageP1DelegatesBound !== '1') {
            homepageModule.dataset.homepageP1DelegatesBound = '1';
            homepageModule.addEventListener('click', (event) => {
                const actionEl = event.target.closest('[data-homepage-action]');
                if (!actionEl || !homepageModule.contains(actionEl) || actionEl.disabled) {
                    return;
                }

                const action = String(actionEl.dataset.homepageAction || '').trim();
                switch (action) {
                    case 'add-hero-entry':
                        addHomepageHeroEntry();
                        break;
                    case 'move-hero-entry':
                        moveHomepageHeroEntry(actionEl.dataset.homepageIndex, actionEl.dataset.homepageDirection);
                        break;
                    case 'remove-hero-entry':
                        removeHomepageHeroEntry(actionEl.dataset.homepageIndex);
                        break;
                    case 'add-prompt-candidate':
                        void addHomepagePromptCandidate(actionEl.dataset.homepagePromptId).catch((error) => {
                            if (typeof showToast === 'function') {
                                showToast(`加入首页精选失败: ${error.message}`, 'error');
                            }
                        });
                        break;
                    case 'add-shop-product':
                        addHomepageShopProduct(actionEl.dataset.homepageProductId);
                        break;
                    case 'move-shop-curated':
                        moveHomepageShopCurated(actionEl.dataset.homepageIndex, actionEl.dataset.homepageDirection);
                        break;
                    case 'remove-shop-curated':
                        removeHomepageShopCurated(actionEl.dataset.homepageIndex);
                        break;
                    case 'add-guestbook-candidate':
                        addHomepageGuestbookCandidate(actionEl.dataset.homepageMessageId);
                        break;
                    case 'move-guestbook-featured':
                        moveHomepageGuestbookFeatured(actionEl.dataset.homepageIndex, actionEl.dataset.homepageDirection);
                        break;
                    case 'remove-guestbook-featured':
                        removeHomepageGuestbookFeatured(actionEl.dataset.homepageIndex);
                        break;
                    case 'add-guestbook-fallback':
                        addHomepageGuestbookFallback();
                        break;
                    case 'move-guestbook-fallback':
                        moveHomepageGuestbookFallback(actionEl.dataset.homepageIndex, actionEl.dataset.homepageDirection);
                        break;
                    case 'remove-guestbook-fallback':
                        removeHomepageGuestbookFallback(actionEl.dataset.homepageIndex);
                        break;
                    default:
                        break;
                }
            });
        }
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
        publishCurrentHomepageSite,
        rollbackCurrentHomepageSite,
        _handleScreenshotUpload
    };
})();

// Expose globally
window.HomepageAdmin = HomepageAdmin;
