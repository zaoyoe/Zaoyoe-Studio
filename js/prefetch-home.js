/**
 * prefetch-home.js - Cross-page prefetch helpers
 *
 * Loaded on sub-pages.
 * 1. Hovering the site logo keeps homepage data warm.
 * 2. Hovering / touching guestbook entry points warms guestbook data too.
 */
(function () {
    'use strict';

    const Contract = window.HomepageContract || null;
    const HOMEPAGE_PREFETCH_CACHE_KEY = 'homepage_prefetch';
    const HOMEPAGE_CONFIG_LAST_UPDATED_KEY = 'homepage_config_last_updated_at';
    const HOMEPAGE_PREFETCH_SCHEMA_VERSION = '20260415_HOME_VERIFY_DEMO_1';
    const HOMEPAGE_GUESTBOOK_CARD_LIMIT = 6;

    // Only run on sub-pages (not homepage)
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') return;

    let prefetching = false;
    let guestbookPrefetching = false;

    function getCurrentSite() {
        return Contract?.normalizeSite?.(window.SiteConfig?.site) || window.SiteConfig?.site || 'cn';
    }

    function getHomepagePrefetchCacheKey(site = getCurrentSite()) {
        return `${HOMEPAGE_PREFETCH_CACHE_KEY}_${site === 'intl' ? 'intl' : 'cn'}`;
    }

    function getHomepageConfigLastUpdatedKey(site = getCurrentSite()) {
        return `${HOMEPAGE_CONFIG_LAST_UPDATED_KEY}_${site === 'intl' ? 'intl' : 'cn'}`;
    }

    async function loadHomepageConfigRows(site = getCurrentSite()) {
        const { data, error } = await window.supabaseClient
            .rpc('fn_get_homepage_config', {
                p_site: site,
                p_include_hidden: false
            });

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    function getHomepageConfigLastUpdatedAt() {
        try {
            const raw = localStorage.getItem(getHomepageConfigLastUpdatedKey());
            const parsed = Number.parseInt(raw || '0', 10);
            return Number.isFinite(parsed) ? parsed : 0;
        } catch (e) {
            return 0;
        }
    }

    function hasFreshPrefetch(storageKey, maxAgeMs = 300000) {
        try {
            const raw = sessionStorage.getItem(storageKey);
            if (!raw) return false;

            const data = JSON.parse(raw);
            return Boolean(data?.timestamp && (Date.now() - data.timestamp < maxAgeMs));
        } catch (e) {
            return false;
        }
    }

    function getPromptPool() {
        if (Array.isArray(window.PROMPTS)) {
            return window.PROMPTS;
        }
        if (Array.isArray(window.promptsData)) {
            return window.promptsData;
        }
        return [];
    }

    function getLocalizedField(obj, fieldBase) {
        if (Contract?.getLocalizedField) {
            return Contract.getLocalizedField(obj, fieldBase, window.i18n?.getCurrentLanguage?.() || 'zh') || '';
        }

        const lang = window.i18n?.getCurrentLanguage?.() || 'zh';
        return obj?.[`${fieldBase}_${lang}`] || obj?.[fieldBase] || '';
    }

    function getHomepagePrimaryLanguage() {
        return getCurrentSite() === 'intl' ? 'en' : 'zh';
    }

    function isHomepagePrimaryLanguageActive() {
        return (window.i18n?.getCurrentLanguage?.() || 'zh') === getHomepagePrimaryLanguage();
    }

    function cloneExperimentValue(value) {
        if (typeof value === 'string') {
            return String(value);
        }
        if (Array.isArray(value)) {
            return value.map((item) => ({ ...item }));
        }
        return value;
    }

    function getHomepageExperimentAssignmentStorageKey(experimentId = '') {
        return `homepage_experiment_assignment_${getCurrentSite()}_${String(experimentId || '').trim()}`;
    }

    function resolveExperimentVariantKey(experiment = {}) {
        if (!experiment?.id || experiment?.status === 'paused') {
            return 'control';
        }

        try {
            const stored = sessionStorage.getItem(getHomepageExperimentAssignmentStorageKey(experiment.id));
            if (stored === 'control' || stored === 'variant') {
                return stored;
            }
        } catch (error) {
            // Ignore storage failures and fall back to a new assignment.
        }

        const trafficPercent = Math.min(95, Math.max(5, Number(experiment?.traffic_percent || 50) || 50));
        const variantKey = Math.random() * 100 < trafficPercent ? 'variant' : 'control';

        try {
            sessionStorage.setItem(getHomepageExperimentAssignmentStorageKey(experiment.id), variantKey);
        } catch (error) {
            // Ignore storage failures.
        }

        return variantKey;
    }

    function getSectionExperimentValue(sectionKey, config = {}, field = '', fallbackValue = null) {
        const matched = (Array.isArray(config?.experiments) ? config.experiments : [])
            .find((experiment) => experiment?.field === field && experiment?.status !== 'paused');

        if (!matched) {
            return fallbackValue;
        }

        const isListField = field === 'featured_items' || field === 'custom_items';
        if (!isListField && !isHomepagePrimaryLanguageActive()) {
            return fallbackValue;
        }

        const variantKey = resolveExperimentVariantKey(matched);
        return cloneExperimentValue(variantKey === 'variant' ? matched.variant_value : matched.control_value);
    }

    function normalizeFeaturedPromptLookupId(value) {
        return String(value ?? '').trim();
    }

    function findFeaturedPromptRecord(promptPool = [], item = {}) {
        const normalizedId = normalizeFeaturedPromptLookupId(item?.id);
        if (!normalizedId || !Array.isArray(promptPool) || promptPool.length === 0) {
            return null;
        }

        let matchedPrompt = promptPool.find((prompt) => {
            const promptId = normalizeFeaturedPromptLookupId(prompt?.supabaseId ?? prompt?.id);
            return Boolean(promptId) && promptId === normalizedId;
        });

        if (matchedPrompt) {
            return matchedPrompt;
        }

        const numericId = Number.parseInt(normalizedId, 10);
        if (Number.isNaN(numericId)) {
            return null;
        }

        matchedPrompt = promptPool.find((prompt) => {
            const supabaseId = Number.parseInt(prompt?.supabaseId, 10);
            const promptId = Number.parseInt(prompt?.id, 10);
            return (!Number.isNaN(supabaseId) && supabaseId === numericId)
                || (!Number.isNaN(promptId) && promptId === numericId);
        });

        return matchedPrompt || null;
    }

    function buildFeaturedPromptFallback(item = {}) {
        const normalizedId = normalizeFeaturedPromptLookupId(item?.id);
        if (!normalizedId) {
            return null;
        }

        const image = String(item?.image || item?.image_url || '').trim();
        const tags = Array.isArray(item?.tags)
            ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8)
            : [];
        const title = String(item?.title || item?.title_zh || item?.title_en || normalizedId).trim() || normalizedId;

        return {
            id: normalizedId,
            title,
            title_zh: String(item?.title_zh || item?.title || '').trim(),
            title_en: String(item?.title_en || item?.title || '').trim(),
            images: image ? [image] : [],
            tags,
            ai_tags: [...tags],
            aiTags: tags.length > 0 ? { styles: { zh: [...tags], en: [...tags] } } : undefined,
            homepage_featured_fallback: true
        };
    }

    function aggregatePrompts(config = {}) {
        const promptPool = getPromptPool();
        const experimentFeaturedItems = getSectionExperimentValue('prompts', config, 'featured_items', null);
        const featuredItems = Array.isArray(experimentFeaturedItems) && experimentFeaturedItems.length > 0
            ? experimentFeaturedItems
            : config.featured_items;

        if ((Array.isArray(experimentFeaturedItems) && experimentFeaturedItems.length > 0) || (!config.enable_auto && Array.isArray(featuredItems) && featuredItems.length > 0)) {
            return featuredItems
                .map((item) => findFeaturedPromptRecord(promptPool, item) || buildFeaturedPromptFallback(item))
                .filter(Boolean);
        }

        const maxItems = Number(config.max_items) || 24;
        const sortStrategy = String(config.sort || 'popular').trim();
        const sorted = [...promptPool];

        if (sortStrategy === 'popular') {
            sorted.sort((left, right) => {
                const leftCount = Object.values(left.aiTags || {}).flat().length;
                const rightCount = Object.values(right.aiTags || {}).flat().length;
                return rightCount - leftCount;
            });
        } else if (sortStrategy === 'latest') {
            sorted.reverse();
        } else if (sortStrategy === 'random') {
            sorted.sort(() => Math.random() - 0.5);
        }

        return sorted.slice(0, maxItems);
    }

    function aggregateShop(config = {}, products = []) {
        const allProducts = Array.isArray(products) ? products : [];
        const experimentCustomItems = getSectionExperimentValue('shop', config, 'custom_items', null);
        const sourceCustomItems = Array.isArray(experimentCustomItems) && experimentCustomItems.length > 0
            ? experimentCustomItems
            : config.custom_items;
        const curatedItems = Array.isArray(sourceCustomItems)
            ? sourceCustomItems
                .map((item) => {
                    const normalizedId = String(item?.id || '').trim();
                    if (!normalizedId) {
                        return null;
                    }
                    const liveProduct = allProducts.find((product) => String(product?.id || '').trim() === normalizedId);
                    return {
                        ...(liveProduct || item),
                        id: normalizedId,
                        homepage_badge: String(item?.badge || '').trim(),
                        homepage_curated: true,
                        homepage_missing: !liveProduct
                    };
                })
                .filter(Boolean)
            : [];
        const curatedIds = new Set(curatedItems.map((item) => String(item?.id || '').trim()).filter(Boolean));

        let filteredShopResult = window.SiteConfig?.filterProductsForCurrentSite
            ? window.SiteConfig.filterProductsForCurrentSite(allProducts)
            : allProducts;

        if (config.category && config.category !== 'all') {
            filteredShopResult = filteredShopResult.filter((product) => product.category === config.category);
        }

        const sortStrategy = String(config.sort || 'popular').trim();
        if (sortStrategy === 'latest') {
            filteredShopResult = [...filteredShopResult].reverse();
        } else if (sortStrategy === 'random') {
            filteredShopResult = [...filteredShopResult].sort(() => Math.random() - 0.5);
        }

        const autoItems = filteredShopResult.filter((item) => !curatedIds.has(String(item?.id || '').trim()));
        const maxItems = Number(config.max_items) || 6;

        if (config.enable_auto === false) {
            return curatedItems.slice(0, maxItems);
        }

        return [...curatedItems, ...autoItems].slice(0, maxItems);
    }

    function aggregateGuestbook(config = {}, messages = []) {
        const sourceMessages = Array.isArray(messages) ? messages : [];
        const maxItems = Math.max(1, Number(config.max_items) || HOMEPAGE_GUESTBOOK_CARD_LIMIT);
        const experimentFeaturedItems = getSectionExperimentValue('guestbook', config, 'featured_items', null);
        const sourceFeaturedItems = Array.isArray(experimentFeaturedItems) && experimentFeaturedItems.length > 0
            ? experimentFeaturedItems
            : config.featured_items;
        const featuredItems = Array.isArray(sourceFeaturedItems)
            ? sourceFeaturedItems
                .map((item) => {
                    const normalizedId = String(item?.id || '').trim();
                    if (!normalizedId) {
                        return null;
                    }
                    const liveMessage = sourceMessages.find((message) => String(message?.id || '').trim() === normalizedId);
                    if (liveMessage) {
                        return {
                            ...liveMessage,
                            homepage_curated: true,
                            homepage_reason: String(item?.reason || '').trim()
                        };
                    }
                    if (!item?.content) {
                        return null;
                    }
                    return {
                        id: normalizedId,
                        content: String(item?.content || '').trim(),
                        image_url: String(item?.image_url || '').trim(),
                        like_count: Number(item?.like_count || 0) || 0,
                        created_at: item?.created_at || null,
                        username: String(item?.username || '').trim(),
                        avatar_url: String(item?.avatar_url || '').trim(),
                        homepage_curated: true,
                        homepage_reason: String(item?.reason || '').trim(),
                        homepage_missing: true
                    };
                })
                .filter(Boolean)
            : [];
        const featuredIds = new Set(featuredItems.map((item) => String(item?.id || '').trim()).filter(Boolean));
        const autoItems = sourceMessages.filter((item) => !featuredIds.has(String(item?.id || '').trim()));
        const fallbackItems = Array.isArray(config.fallback_items)
            ? config.fallback_items
                .map((item, index) => {
                    const content = String(item?.content || item?.text || '').trim();
                    if (!content) {
                        return null;
                    }
                    return {
                        id: String(item?.id || `guestbook_fallback_${index + 1}`).trim(),
                        content,
                        author: String(item?.author || '').trim(),
                        avatar_url: String(item?.avatar_url || '').trim(),
                        homepage_fallback: true
                    };
                })
                .filter(Boolean)
            : [];

        if (config.enable_auto === false) {
            return [...featuredItems, ...fallbackItems].slice(0, Math.min(maxItems, HOMEPAGE_GUESTBOOK_CARD_LIMIT));
        }

        return [...featuredItems, ...autoItems, ...fallbackItems].slice(0, Math.min(maxItems, HOMEPAGE_GUESTBOOK_CARD_LIMIT));
    }

    function sanitizeTickerItems(value) {
        return Array.isArray(value)
            ? value.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
    }

    function buildTickerData(config = {}, prompts = [], shop = []) {
        const lang = window.i18n?.getCurrentLanguage?.() || 'zh';
        let top = [
            ...sanitizeTickerItems(config.prompt_tags),
            ...sanitizeTickerItems(config.activity_keywords),
            ...sanitizeTickerItems(config.custom_items_top)
        ];
        let bottom = [
            ...sanitizeTickerItems(config.product_categories),
            ...sanitizeTickerItems(config.custom_items_bottom)
        ];
        const productCategories = Array.from(new Set(bottom));

        if ((config.enable_auto !== false || top.length === 0) && config.enable_prompts !== false) {
            const tagSet = new Set(top);
            prompts.forEach((prompt) => {
                if (prompt?.aiTags && typeof prompt.aiTags === 'object') {
                    ['styles', 'objects', 'scenes', 'mood'].forEach((category) => {
                        const tags = prompt.aiTags[category]?.[lang] || prompt.aiTags[category]?.zh || [];
                        tags.forEach((tag) => tagSet.add(tag));
                    });
                }
            });
            top = Array.from(tagSet).slice(0, 20);
        } else if (config.enable_prompts === false) {
            top = [];
        }

        if ((config.enable_auto !== false || productCategories.length === 0) && config.enable_products !== false) {
            const categorySet = new Set(productCategories);
            shop
                .map((product) => String(product?.category || '').trim())
                .filter(Boolean)
                .forEach((category) => categorySet.add(category));
            productCategories.splice(0, productCategories.length, ...Array.from(categorySet).slice(0, 20));
        } else if (config.enable_products === false) {
            productCategories.splice(0, productCategories.length);
        }

        return {
            top,
            bottom: productCategories,
            speed: Number(config.speed) || 30,
            shopScrollSpeed: Number(config.shop_scroll_speed) || Number(config.speed) || 30,
            enable_prompts: config.enable_prompts !== false,
            enable_products: config.enable_products !== false
        };
    }

    function buildHeroData(config = {}) {
        const experimentTitle = getSectionExperimentValue('hero', config, 'title', '');
        const experimentSubtitle = getSectionExperimentValue('hero', config, 'subtitle', '');
        const configuredEntries = Array.isArray(config?.entries) && config.entries.length > 0
            ? config.entries
            : [
                { id: 'prompts', icon: 'fa-wand-magic-sparkles', text: window.i18n?.t('home.entries.prompts') || '提示词', link: '/prompts.html', color: '#f472b6', section: 'prompts' },
                { id: 'gongyi', icon: 'home-entry-card-icon--gongyi', text: window.i18n?.t('home.entries.gongyi') || '公益站', link: 'https://gongyi.zaoyoe.com', color: '#5ed8f8', section: 'gongyi' },
                { id: 'shop', icon: 'fa-store', text: window.i18n?.t('home.entries.shop') || '商城', link: '/shop.html', color: '#4ade80', section: 'shop' },
                { id: 'verify', icon: 'fa-robot', text: window.i18n?.t('home.entries.verify') || '验证', link: '/verify.html', color: '#667eea', section: 'verify' },
                { id: 'guestbook', icon: 'fa-comment-dots', text: window.i18n?.t('home.entries.guestbook') || '留言板', link: '#', color: '#f59e0b', action: 'openGuestbookModal', section: 'guestbook' }
            ];
        return {
            title: experimentTitle || getLocalizedField(config, 'title') || window.i18n?.t('home.hero.title') || '早鸟',
            subtitle: experimentSubtitle || getLocalizedField(config, 'subtitle') || window.i18n?.t('home.hero.subtitle') || 'AI 驱动的创意资源平台',
            customImage: config.custom_image || null,
            entries: configuredEntries
                .filter((item) => item?.enabled !== false)
                .map((item, index) => ({
                    id: String(item?.id || item?.section || item?.action || item?.link || `hero_entry_${index + 1}`).trim(),
                    icon: String(item?.icon || 'fa-star').trim(),
                    text: getLocalizedField(item, 'text') || item?.text || `入口 ${index + 1}`,
                    link: String(item?.link || (item?.section ? `#${item.section}` : '#')).trim() || '#',
                    color: String(item?.color || '#ffffff').trim() || '#ffffff',
                    action: String(item?.action || '').trim(),
                    section: String(item?.section || '').trim()
                }))
                .slice(0, 8)
        };
    }

    function buildGongyiData(config = {}) {
        const defaultCards = [
            { title: '一键接入', description: '获取一个 API 密钥，即可调用所有已接入的 AI 模型，无需分别申请。' },
            { title: '稳定可靠', description: '智能调度多个上游账号，自动切换和负载均衡，告别频繁报错。' },
            { title: '用多少付多少', description: '按实际使用量计费，支持设置额度上限，团队用量一目了然。' }
        ];
        const defaultModels = [
            { id: 'claude', label: 'Claude' },
            { id: 'gpt', label: 'GPT' },
            { id: 'gemini', label: 'Gemini' },
            { id: 'antigravity', label: 'Antigravity' },
            { id: 'more', label: '更多' }
        ];
        const sourceModels = Array.isArray(config.model_items) && config.model_items.length > 0
            ? config.model_items
            : defaultModels;
        const visibleModelItems = sourceModels
            .map((item, index) => {
                if (typeof item === 'string') {
                    const label = String(item || '').trim();
                    return label ? { id: `model_${index + 1}`, label, enabled: true } : null;
                }
                if (!item || typeof item !== 'object') {
                    return null;
                }
                const label = String(item.label || item.name || item.title || '').trim();
                if (!label) {
                    return null;
                }
                return {
                    id: String(item.id || `model_${index + 1}`).trim(),
                    label,
                    enabled: item.enabled !== false
                };
            })
            .filter(Boolean)
            .filter((item) => item.enabled !== false);

        return {
            brandName: String(config.brand_name || '').trim() || 'Zaoyoe',
            brandSubtitle: getLocalizedField(config, 'brand_subtitle') || 'Subscription to API Conversion Platform',
            ctaText: getLocalizedField(config, 'cta_text') || '进入控制台',
            ctaLink: String(config.cta_link || '').trim() || 'https://gongyi.zaoyoe.com',
            highlights: Array.isArray(config.highlight_items) && config.highlight_items.length > 0
                ? config.highlight_items
                : ['订阅转 API', '会话保持', '按量计费'],
            featureCards: defaultCards.map((card, index) => {
                const baseKey = `feature_${index + 1}`;
                return {
                    title: getLocalizedField(config, `${baseKey}_title`) || card.title,
                    description: getLocalizedField(config, `${baseKey}_description`) || card.description
                };
            }),
            showModelSection: config.show_model_section !== false && visibleModelItems.length > 0,
            modelItems: visibleModelItems
        };
    }

    function buildVerifyData(config = {}) {
        const experimentCtaText = getSectionExperimentValue('verify', config, 'cta_text', '');
        const defaultValueProps = [
            window.i18n?.t('home.verify.valueProps.fast') || '秒级校验',
            window.i18n?.t('home.verify.valueProps.visible') || '过程可见',
            window.i18n?.t('home.verify.valueProps.safe') || '结果可追踪'
        ];
        const defaultModels = ['Gemini', 'Claude', 'OpenAI'];
        const demoCostPoints = Number.parseInt(config.demo_cost_points, 10);
        return {
            title: getLocalizedField(config, 'section_title') || 'Gemini 验证',
            subtitle: getLocalizedField(config, 'section_subtitle') || '快速验证您的 API 密钥',
            features: Array.isArray(config.features) && config.features.length > 0
                ? config.features
                : ['批量验证', '实时反馈', '多模型支持'],
            valueProps: Array.isArray(config.value_props) && config.value_props.length > 0
                ? config.value_props
                : defaultValueProps,
            supportedModels: Array.isArray(config.supported_models) && config.supported_models.length > 0
                ? config.supported_models
                : defaultModels,
            ctaText: String(experimentCtaText || config.cta_text || '').trim() || (window.i18n?.t('home.verify.cta') || '立即验证'),
            riskNotice: String(config.risk_notice || '').trim() || (window.i18n?.t('home.verify.riskNotice') || '建议先使用测试账号完成校验，再切换正式账号。'),
            link: String(config.cta_link || '').trim() || '/verify.html?source=homepage_verify',
            screenshot: config.screenshot_path || '/assets/verify-preview.png',
            previewMode: String(config.preview_mode || 'dynamic').trim() === 'image' ? 'image' : 'dynamic',
            demo: {
                title: String(config.demo_title || '').trim() || 'Google One',
                subtitle: String(config.demo_subtitle || '').trim() || '获取 1年 pro 权限的试用链接',
                email: String(config.demo_email || '').trim() || 'preview.account@gmail.com',
                totp: String(config.demo_totp || '').trim() || '3r6cu37xch4ej6d5',
                successLink: String(config.demo_success_link || '').trim() || 'https://services.sheerid.com/verify/zaoyoe-demo?verificationId=GO-8K21',
                quota: String(config.demo_quota || '').trim() || '0.5 提 / 全 1',
                balance: String(config.demo_balance || '').trim() || '7.6',
                costPoints: Number.isFinite(demoCostPoints) && demoCostPoints > 0 ? demoCostPoints : 10
            }
        };
    }

    function checkAndPrefetch() {
        if (prefetching) return;
        const currentSite = getCurrentSite();

        try {
            const raw = sessionStorage.getItem(getHomepagePrefetchCacheKey(currentSite));
            if (raw) {
                const data = JSON.parse(raw);
                if (data?.site && data.site !== currentSite) {
                    sessionStorage.removeItem(getHomepagePrefetchCacheKey(currentSite));
                    return;
                }

                const age = Date.now() - (data.timestamp || 0);
                const configUpdatedAt = getHomepageConfigLastUpdatedAt();
                const isFreshConfig = !configUpdatedAt || (data.timestamp || 0) >= configUpdatedAt;
                if (age < 300000 && isFreshConfig) {
                    return;
                }
                sessionStorage.removeItem(getHomepagePrefetchCacheKey(currentSite));
            }
        } catch (e) {
            // ignore parse failures
        }

        prefetching = true;
        prefetchHomepageData().finally(() => { prefetching = false; });
    }

    async function prefetchGuestbookData() {
        if (guestbookPrefetching || hasFreshPrefetch('guestbook_prefetch')) return;
        guestbookPrefetching = true;

        try {
            if (!window.supabaseClient) return;

            const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
            const userId = session?.user?.id || null;
            const { data, error } = await window.supabaseClient
                .rpc('fn_load_guestbook', {
                    p_site: getCurrentSite(),
                    p_limit: 50,
                    p_user_id: userId
                });

            if (error) throw error;
            if (!data) return;

            sessionStorage.setItem('guestbook_prefetch', JSON.stringify({
                data,
                timestamp: Date.now(),
                site: getCurrentSite()
            }));

            console.log('⚡ Guestbook data prefetched on sub-page hover');
        } catch (e) {
            console.warn('Guestbook prefetch failed:', e.message);
        } finally {
            guestbookPrefetching = false;
        }
    }

    async function prefetchHomepageData() {
        try {
            if (!window.supabaseClient) return;

            const rows = await loadHomepageConfigRows(getCurrentSite());
            const config = Contract?.buildConfigMap?.(rows) || {};
            const sectionRows = Contract?.mapRowsBySection?.(rows) || {};
            const sectionOrder = Contract?.sortSectionsByDisplayOrder?.(rows) || ['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker'];
            const promptPool = getPromptPool();

            const [shopResult, guestbookResult] = await Promise.all([
                window.supabaseClient
                    .from('shop_products')
                    .select('id, name, name_en, description, description_en, icon_url, price_points, price_points_intl, stock_count, category, display_order')
                    .eq('is_active', true)
                    .order('display_order', { ascending: false }),
                window.supabaseClient
                    .from('guestbook_messages')
                    .select('id, content, image_url, like_count, created_at, user_id, profiles:user_id (username, avatar_url)')
                    .eq('site', getCurrentSite())
                    .order('created_at', { ascending: false })
                    .limit(HOMEPAGE_GUESTBOOK_CARD_LIMIT)
            ]);

            if (shopResult.error) throw shopResult.error;
            if (guestbookResult.error) throw guestbookResult.error;

            const allProducts = Array.isArray(shopResult.data) ? shopResult.data : [];
            const guestbookMessages = Array.isArray(guestbookResult.data) ? guestbookResult.data : [];
            const prompts = aggregatePrompts(config.prompts || {});
            const shop = aggregateShop(config.shop || {}, allProducts);
            const guestbook = aggregateGuestbook(config.guestbook || {}, guestbookMessages);
            const ticker = {
                ...buildTickerData(config.ticker || {}, promptPool, shop),
                speed: config.ticker?.speed || 30,
                shopScrollSpeed: config.ticker?.shop_scroll_speed || config.ticker?.speed || 30
            };
            const cacheKind = promptPool.length > 0 ? 'complete' : 'partial';
            const currentSite = getCurrentSite();

            sessionStorage.setItem(getHomepagePrefetchCacheKey(currentSite), JSON.stringify({
                cachedData: {
                    hero: buildHeroData(config.hero || {}),
                    prompts,
                    shop,
                    gongyi: buildGongyiData(config.gongyi || {}),
                    verify: buildVerifyData(config.verify || {}),
                    guestbook,
                    ticker,
                    shopCategories: []
                },
                config,
                sectionRows,
                sectionOrder,
                cacheKind,
                schemaVersion: HOMEPAGE_PREFETCH_SCHEMA_VERSION,
                timestamp: Date.now(),
                site: currentSite
            }));

            console.log(`⚡ Homepage data prefetched on logo hover (${cacheKind})`);
        } catch (e) {
            console.warn('Homepage prefetch failed:', e.message);
        }
    }

    function shouldPrefetchGuestbook(target) {
        return Boolean(target.closest(
            'a[href="/guestbook.html"], a[href="guestbook.html"], a[href="#guestbook"], [onclick*="openGuestbookModal"]'
        ));
    }

    document.addEventListener('mouseover', (e) => {
        if (shouldPrefetchGuestbook(e.target)) {
            prefetchGuestbookData();
            return;
        }

        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (logo) checkAndPrefetch();
    });

    document.addEventListener('touchstart', (e) => {
        if (shouldPrefetchGuestbook(e.target)) {
            prefetchGuestbookData();
            return;
        }

        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (logo) checkAndPrefetch();
    }, { passive: true });

    window._prefetchGuestbook = prefetchGuestbookData;
})();
