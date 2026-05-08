/**
 * prefetch-home.js - Cross-page prefetch helpers
 *
 * Loaded on sub-pages.
 * 1. Hovering the site logo keeps homepage data warm when logo still points home.
 * 2. Hovering / touching guestbook entry points warms guestbook data too.
 */
(function () {
    'use strict';

    const Contract = window.HomepageContract || null;
    const HOMEPAGE_PREFETCH_CACHE_KEY = 'homepage_prefetch';
    const HOMEPAGE_CONFIG_LAST_UPDATED_KEY = 'homepage_config_last_updated_at';
    const HOMEPAGE_PROMPT_POOL_LAST_UPDATED_KEY = 'homepage_prompt_pool_last_updated_at';
    const HOMEPAGE_PREFETCH_SCHEMA_VERSION = '20260508_HOME_BILINGUAL_RUNTIME_1';
    const HOMEPAGE_GUESTBOOK_CARD_LIMIT = 6;
    const HOMEPAGE_PROMPT_LIVE_SELECT = [
        'id',
        'title',
        'title_zh',
        'title_en',
        'description',
        'description_zh',
        'description_en',
        'prompt_text',
        'prompt_text_zh',
        'prompt_text_en',
        'images',
        'image_assets',
        'dominant_colors',
        'ai_tags',
        'tags',
        'created_at',
        'updated_at'
    ].join(', ');
    const HOMEPAGE_PROMPT_LIVE_LEGACY_SELECT = HOMEPAGE_PROMPT_LIVE_SELECT
        .split(', ')
        .filter((field) => field !== 'image_assets')
        .join(', ');

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

    function getHomepagePromptPoolLastUpdatedKey(site = getCurrentSite()) {
        return `${HOMEPAGE_PROMPT_POOL_LAST_UPDATED_KEY}_${site === 'intl' ? 'intl' : 'cn'}`;
    }

    function getCurrentLanguage() {
        return window.i18n?.getCurrentLanguage?.() === 'en' ? 'en' : 'zh';
    }

    function containsCjkText(value) {
        return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
    }

    function getLanguageFallback(i18nKey, fallbackByLanguage = {}) {
        const lang = getCurrentLanguage();
        const translated = i18nKey ? window.i18n?.t?.(i18nKey) : '';
        return (translated && translated !== i18nKey ? translated : '') || getStrictLanguageFallback(fallbackByLanguage);
    }

    function resolveLocalizedText(value, i18nKey, fallbackByLanguage = {}) {
        const normalized = String(value || '').trim();
        const fallback = getLanguageFallback(i18nKey, fallbackByLanguage);
        const currentLang = getCurrentLanguage();

        if (currentLang === 'en' && containsCjkText(normalized)) {
            return fallback;
        }

        if (
            currentLang === 'zh'
            && normalized
            && !containsCjkText(normalized)
            && containsCjkText(fallback)
        ) {
            return fallback;
        }

        return normalized || fallback;
    }

    function getStrictLanguageFallback(fallbackByLanguage = {}) {
        const lang = getCurrentLanguage();
        if (Object.prototype.hasOwnProperty.call(fallbackByLanguage, lang)) {
            return fallbackByLanguage[lang] || '';
        }
        return lang === 'zh' ? (fallbackByLanguage.zh || '') : '';
    }

    function resolveDataText(value, fallbackByLanguage = {}) {
        const normalized = String(value || '').trim();
        if (getCurrentLanguage() === 'en' && containsCjkText(normalized)) {
            return getStrictLanguageFallback(fallbackByLanguage);
        }
        return normalized || getStrictLanguageFallback(fallbackByLanguage);
    }

    function getLocalizedDataField(item = {}, fieldBase, fallbackByLanguage = {}) {
        if (!item || typeof item !== 'object') {
            return getStrictLanguageFallback(fallbackByLanguage);
        }
        const lang = getCurrentLanguage();
        const primary = String(item?.[`${fieldBase}_${lang}`] || '').trim();
        if (primary) {
            return resolveDataText(primary, fallbackByLanguage);
        }
        const base = String(item?.[fieldBase] || '').trim();
        if (base) {
            return resolveDataText(base, fallbackByLanguage);
        }
        if (lang === 'zh') {
            return String(item?.[`${fieldBase}_en`] || '').trim() || getStrictLanguageFallback(fallbackByLanguage);
        }
        return getStrictLanguageFallback(fallbackByLanguage);
    }

    function normalizeGuestbookRpcMessages(source) {
        if (Array.isArray(source?.messages)) {
            return source.messages;
        }
        return Array.isArray(source) ? source : [];
    }

    async function fetchHomepageGuestbookMessages(limit = HOMEPAGE_GUESTBOOK_CARD_LIMIT) {
        try {
            const { data, error } = await window.supabaseClient
                .rpc('fn_load_guestbook', {
                    p_site: getCurrentSite(),
                    p_limit: Math.max(limit, HOMEPAGE_GUESTBOOK_CARD_LIMIT),
                    p_user_id: null
                });
            if (error) throw error;
            return normalizeGuestbookRpcMessages(data).slice(0, limit);
        } catch (error) {
            console.warn('Homepage guestbook RPC prefetch failed, using direct fetch:', error?.message || error);
            const { data, error: directError } = await window.supabaseClient
                .from('guestbook_messages')
                .select('id, content, image_url, like_count, created_at, user_id, profiles:user_id (username, avatar_url)')
                .eq('site', getCurrentSite())
                .order('created_at', { ascending: false })
                .limit(limit);
            if (directError) throw directError;
            return Array.isArray(data) ? data : [];
        }
    }

    function normalizeTextList(value) {
        return Array.isArray(value)
            ? value.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
    }

    function resolveLocalizedTextList(value, fallbackItems = []) {
        const normalized = normalizeTextList(value);
        const fallbackList = normalizeTextList(fallbackItems);
        const currentLang = getCurrentLanguage();

        if (currentLang === 'en' && normalized.some((item) => containsCjkText(item))) {
            return fallbackList;
        }

        if (
            currentLang === 'zh'
            && normalized.length > 0
            && normalized.every((item) => !containsCjkText(item))
            && fallbackList.some((item) => containsCjkText(item))
        ) {
            return fallbackList;
        }

        return normalized.length > 0 ? normalized : fallbackList;
    }

    function filterDataTextList(value) {
        const normalized = normalizeTextList(value);
        return getCurrentLanguage() === 'en'
            ? normalized.filter((item) => !containsCjkText(item))
            : normalized;
    }

    function resolveHeroText(value, i18nKey, fallbackByLanguage = {}) {
        return resolveLocalizedText(value, i18nKey, fallbackByLanguage);
    }

    function getHeroEntryFallback(item = {}, index = 0) {
        const key = String(item?.section || item?.id || '').trim().toLowerCase();
        const fallbackByKey = {
            prompts: { i18nKey: 'home.entries.prompts', zh: '提示词', en: 'Prompts' },
            gongyi: { i18nKey: 'home.entries.gongyi', zh: '公益站', en: 'Community Access' },
            shop: { i18nKey: 'home.entries.shop', zh: '商城', en: 'Shop' },
            verify: { i18nKey: 'home.entries.verify', zh: '验证', en: 'Verify' },
            guestbook: { i18nKey: 'home.entries.guestbook', zh: '留言板', en: 'Guestbook' }
        };
        return fallbackByKey[key] || {
            i18nKey: '',
            zh: `入口 ${index + 1}`,
            en: `Entry ${index + 1}`
        };
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
            return filterVisibleHomepagePrompts(window.PROMPTS);
        }
        if (Array.isArray(window.promptsData)) {
            return filterVisibleHomepagePrompts(window.promptsData);
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

    function isMissingPromptImageAssetsColumnError(error) {
        const message = String(error?.message || '').toLowerCase();
        return Boolean(message && (
            message.includes('image_assets')
            || message.includes('column of "prompts"')
            || message.includes("column of 'prompts'")
        ));
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

    function normalizePromptImageAsset(value) {
        if (typeof value === 'string') {
            const original = value.trim();
            return original ? { original } : null;
        }

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }

        const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
            ? value.variants
            : {};
        const asset = {};

        for (const key of ['original', 'thumb', 'featured', 'card', 'home']) {
            const url = String(value[key] || variants[key] || '').trim();
            if (url) {
                asset[key] = url;
            }
        }

        const fallbackOriginal = String(value.url || value.src || value.image || '').trim();
        if (!asset.original && fallbackOriginal) {
            asset.original = fallbackOriginal;
        }

        return asset.original || asset.thumb || asset.featured || asset.card || asset.home ? asset : null;
    }

    function normalizePromptImageAssetsFromRecord(prompt = {}) {
        const explicitAssets = Array.isArray(prompt?.imageAssets)
            ? prompt.imageAssets
            : (Array.isArray(prompt?.image_assets) ? prompt.image_assets : []);
        const legacyImages = Array.isArray(prompt?.images) ? prompt.images : [];
        const assets = [];
        const seen = new Set();

        for (const source of [...explicitAssets, ...legacyImages]) {
            const asset = normalizePromptImageAsset(source);
            if (!asset) continue;
            const key = String(asset.original || asset.card || asset.home || asset.thumb || '').trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            assets.push(asset);
        }

        return assets;
    }

    function normalizeHomepagePromptRecord(prompt = {}) {
        const normalizedId = String(prompt?.supabaseId || prompt?.id || '').trim();
        const promptText = String(prompt?.prompt_text || prompt?.prompt || '').trim();
        const aiTags = prompt?.aiTags && typeof prompt.aiTags === 'object' && !Array.isArray(prompt.aiTags)
            ? prompt.aiTags
            : (prompt?.ai_tags && typeof prompt.ai_tags === 'object' && !Array.isArray(prompt.ai_tags)
                ? prompt.ai_tags
                : {});
        const imageAssets = normalizePromptImageAssetsFromRecord({
            ...prompt,
            images: [
                ...(Array.isArray(prompt?.images) ? prompt.images : []),
                prompt?.image,
                prompt?.image_url,
                prompt?.imageUrl,
                prompt?.cover_image,
                prompt?.coverImage,
                prompt?.cover_url,
                prompt?.coverUrl,
                prompt?.thumbnail_url,
                prompt?.thumbnailUrl
            ]
        });
        const images = imageAssets
            .map((asset) => String(asset.original || asset.card || asset.home || asset.thumb || '').trim())
            .filter(Boolean);

        return {
            ...prompt,
            id: normalizedId || String(prompt?.id || '').trim(),
            supabaseId: normalizedId || String(prompt?.supabaseId || '').trim(),
            title: String(prompt?.title || prompt?.title_zh || prompt?.title_en || '').trim(),
            title_zh: String(prompt?.title_zh || prompt?.title || '').trim(),
            title_en: String(prompt?.title_en || prompt?.title || '').trim(),
            tags: Array.isArray(prompt?.tags) ? prompt.tags : [],
            description: String(prompt?.description || prompt?.description_zh || prompt?.description_en || '').trim(),
            description_zh: String(prompt?.description_zh || prompt?.description || '').trim(),
            description_en: String(prompt?.description_en || prompt?.description || '').trim(),
            prompt: promptText,
            prompt_text: promptText,
            prompt_text_zh: String(prompt?.prompt_text_zh || promptText).trim(),
            prompt_text_en: String(prompt?.prompt_text_en || '').trim(),
            images,
            imageAssets,
            image_assets: imageAssets,
            image: images[0] || '',
            image_url: String(prompt?.image_url || images[0] || '').trim(),
            dominantColors: Array.isArray(prompt?.dominantColors)
                ? prompt.dominantColors
                : (Array.isArray(prompt?.dominant_colors) ? prompt.dominant_colors : []),
            dominant_colors: Array.isArray(prompt?.dominant_colors)
                ? prompt.dominant_colors
                : (Array.isArray(prompt?.dominantColors) ? prompt.dominantColors : []),
            aiTags,
            ai_tags: aiTags
        };
    }

    function getHomepagePromptAdminVisibilityStatus(prompt = {}) {
        const aiTags = prompt?.aiTags && typeof prompt.aiTags === 'object' && !Array.isArray(prompt.aiTags)
            ? prompt.aiTags
            : (prompt?.ai_tags && typeof prompt.ai_tags === 'object' && !Array.isArray(prompt.ai_tags)
                ? prompt.ai_tags
                : {});
        const adminOps = aiTags?.admin && typeof aiTags.admin === 'object' && !Array.isArray(aiTags.admin)
            ? aiTags.admin
            : (aiTags?.ops && typeof aiTags.ops === 'object' && !Array.isArray(aiTags.ops)
                ? aiTags.ops
                : {});
        return String(adminOps.status || '').trim().toLowerCase();
    }

    function hasHomepagePromptVisibleCopy(value) {
        return String(value || '').trim().length > 0;
    }

    function isHomepagePromptVisible(prompt = {}) {
        const status = getHomepagePromptAdminVisibilityStatus(prompt);
        if (status === 'draft' || status === 'archived') {
            return false;
        }

        const normalizedPrompt = normalizeHomepagePromptRecord(prompt);
        const hasBaseTitle = hasHomepagePromptVisibleCopy(normalizedPrompt?.title);
        const hasPromptText = hasHomepagePromptVisibleCopy(normalizedPrompt?.prompt_text || normalizedPrompt?.prompt);
        const hasImages = Array.isArray(normalizedPrompt?.images) && normalizedPrompt.images.some((item) => hasHomepagePromptVisibleCopy(item));

        return hasBaseTitle && hasPromptText && hasImages;
    }

    function filterVisibleHomepagePrompts(prompts = []) {
        return (Array.isArray(prompts) ? prompts : [])
            .map((prompt) => normalizeHomepagePromptRecord(prompt))
            .filter((prompt) => isHomepagePromptVisible(prompt));
    }

    async function fetchVisiblePromptPool() {
        const fallbackPool = getPromptPool();

        if (!window.supabaseClient) {
            return {
                items: fallbackPool,
                source: 'fallback'
            };
        }

        try {
            let { data, error } = await window.supabaseClient
                .from('prompts')
                .select(HOMEPAGE_PROMPT_LIVE_SELECT)
                .order('updated_at', { ascending: false })
                .limit(80);

            if (error && isMissingPromptImageAssetsColumnError(error)) {
                const fallbackResult = await window.supabaseClient
                    .from('prompts')
                    .select(HOMEPAGE_PROMPT_LIVE_LEGACY_SELECT)
                    .order('updated_at', { ascending: false })
                    .limit(80);
                data = fallbackResult.data;
                error = fallbackResult.error;
            }

            if (error) {
                throw error;
            }

            return {
                items: filterVisibleHomepagePrompts(data),
                source: 'live'
            };
        } catch (error) {
            console.warn('Homepage prefetch prompt pool fallback:', error?.message || error);
            return {
                items: fallbackPool,
                source: 'fallback'
            };
        }
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

        const normalizedItem = normalizeHomepagePromptRecord(item);
        const image = String(normalizedItem?.image || normalizedItem?.image_url || '').trim();
        const tags = Array.isArray(item?.tags)
            ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8)
            : [];
        const title = String(item?.title || item?.title_zh || item?.title_en || normalizedId).trim() || normalizedId;

        return {
            id: normalizedId,
            title,
            title_zh: String(item?.title_zh || item?.title || '').trim(),
            title_en: String(item?.title_en || item?.title || '').trim(),
            images: normalizedItem.images,
            image,
            image_url: image,
            tags,
            ai_tags: [...tags],
            aiTags: tags.length > 0 ? { styles: { zh: [...tags], en: [...tags] } } : undefined,
            homepage_featured_fallback: true
        };
    }

    function aggregatePrompts(config = {}, promptPoolOverride = null) {
        const promptPool = Array.isArray(promptPoolOverride) ? promptPoolOverride : getPromptPool();
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
                            homepage_reason: getLocalizedDataField(item, 'reason', { en: '' })
                        };
                    }
                    const curatedContent = getLocalizedDataField(item, 'content', { en: '' });
                    if (!curatedContent) {
                        return null;
                    }
                    return {
                        id: normalizedId,
                        content: curatedContent,
                        image_url: String(item?.image_url || '').trim(),
                        like_count: Number(item?.like_count || 0) || 0,
                        created_at: item?.created_at || null,
                        username: getLocalizedDataField(item, 'username', {
                            zh: item?.username || '',
                            en: 'Community'
                        }),
                        avatar_url: String(item?.avatar_url || '').trim(),
                        homepage_curated: true,
                        homepage_reason: getLocalizedDataField(item, 'reason', { en: '' }),
                        homepage_missing: true
                    };
                })
                .filter(Boolean)
            : [];
        const featuredIds = new Set(featuredItems.map((item) => String(item?.id || '').trim()).filter(Boolean));
        const autoItems = sourceMessages
            .filter((item) => !featuredIds.has(String(item?.id || '').trim()));
        const fallbackItems = Array.isArray(config.fallback_items)
            ? config.fallback_items
                .filter((item) => getCurrentLanguage() !== 'en' || Boolean(getLocalizedDataField(item, 'content', { en: '' })))
                .map((item, index) => {
                    const content = getLocalizedDataField({
                        ...item,
                        content: item?.content || item?.text || ''
                    }, 'content', { en: '' });
                    if (!content) {
                        return null;
                    }
                    return {
                        id: String(item?.id || `guestbook_fallback_${index + 1}`).trim(),
                        content,
                        author: getLocalizedDataField(item, 'author', {
                            zh: item?.author || '',
                            en: item?.author_en || 'Community'
                        }),
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

    function sanitizeTickerItems(value, { allowCjk = false } = {}) {
        const items = Array.isArray(value)
            ? value.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        return getCurrentLanguage() === 'en' && !allowCjk
            ? items.filter((item) => !containsCjkText(item))
            : items;
    }

    function buildTickerData(config = {}, prompts = [], shop = []) {
        const lang = window.i18n?.getCurrentLanguage?.() || 'zh';
        let top = [
            ...sanitizeTickerItems(config.prompt_tags),
            ...sanitizeTickerItems(config.activity_keywords),
            ...sanitizeTickerItems(config.custom_items_top)
        ];
        let bottom = [
            ...sanitizeTickerItems(config.product_categories, { allowCjk: true }),
            ...sanitizeTickerItems(config.custom_items_bottom, { allowCjk: true })
        ];
        const productCategories = Array.from(new Set(bottom));

        if ((config.enable_auto !== false || top.length === 0) && config.enable_prompts !== false) {
            const tagSet = new Set(top);
            prompts.forEach((prompt) => {
                if (prompt?.aiTags && typeof prompt.aiTags === 'object') {
                    ['styles', 'objects', 'scenes', 'mood'].forEach((category) => {
                        const tags = prompt.aiTags[category]?.[lang] || (lang === 'en' ? [] : (prompt.aiTags[category]?.zh || []));
                        tags.forEach((tag) => tagSet.add(tag));
                    });
                }
            });
            top = sanitizeTickerItems(Array.from(tagSet)).slice(0, 20);
        } else if (config.enable_prompts === false) {
            top = [];
        }

        if ((config.enable_auto !== false || productCategories.length === 0) && config.enable_products !== false) {
            const categorySet = new Set(productCategories);
            shop
                .map((product) => String(product?.category || '').trim())
                .filter(Boolean)
                .forEach((category) => categorySet.add(category));
            productCategories.splice(0, productCategories.length, ...sanitizeTickerItems(Array.from(categorySet), { allowCjk: true }).slice(0, 20));
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
            title: resolveHeroText(experimentTitle || getLocalizedField(config, 'title'), 'home.hero.title', {
                zh: '早鸟',
                en: 'Zaoyoe Studio'
            }),
            subtitle: resolveHeroText(experimentSubtitle || getLocalizedField(config, 'subtitle'), 'home.hero.subtitle', {
                zh: '创意 · 效率 · 无限可能',
                en: 'Creativity · Efficiency · Endless Possibilities'
            }),
            customImage: config.custom_image || null,
            entries: configuredEntries
                .filter((item) => item?.enabled !== false)
                .map((item, index) => {
                    const entryFallback = getHeroEntryFallback(item, index);
                    return {
                        id: String(item?.id || item?.section || item?.action || item?.link || `hero_entry_${index + 1}`).trim(),
                        icon: String(item?.icon || 'fa-star').trim(),
                        text: resolveLocalizedText(getLocalizedField(item, 'text') || item?.text, entryFallback.i18nKey, {
                            zh: entryFallback.zh,
                            en: entryFallback.en
                        }),
                        link: String(item?.link || (item?.section ? `#${item.section}` : '#')).trim() || '#',
                        color: String(item?.color || '#ffffff').trim() || '#ffffff',
                        action: String(item?.action || '').trim(),
                        section: String(item?.section || '').trim()
                    };
                })
                .slice(0, 8)
        };
    }

    function buildGongyiData(config = {}) {
        const isEnglish = getCurrentLanguage() === 'en';
        const defaultCards = isEnglish
            ? [
                { title: 'One-key access', description: 'Use one API key to call every connected AI model without separate applications.' },
                { title: 'Stable routing', description: 'Smartly balance upstream accounts and switch routes automatically to reduce failures.' },
                { title: 'Usage-based billing', description: 'Pay by actual usage, set spending limits, and keep team consumption visible.' }
            ]
            : [
                { title: '一键接入', description: '获取一个 API 密钥，即可调用所有已接入的 AI 模型，无需分别申请。' },
                { title: '稳定可靠', description: '智能调度多个上游账号，自动切换和负载均衡，告别频繁报错。' },
                { title: '用多少付多少', description: '按实际使用量计费，支持设置额度上限，团队用量一目了然。' }
            ];
        const defaultModels = [
            { id: 'claude', label: 'Claude' },
            { id: 'gpt', label: 'GPT' },
            { id: 'gemini', label: 'Gemini' },
            { id: 'antigravity', label: 'Antigravity' },
            { id: 'more', label: isEnglish ? 'More' : '更多' }
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
            brandSubtitle: resolveLocalizedText(getLocalizedField(config, 'brand_subtitle'), '', {
                zh: '订阅转 API 转换平台',
                en: 'Subscription to API Conversion Platform'
            }),
            ctaText: resolveLocalizedText(getLocalizedField(config, 'cta_text'), '', {
                zh: '进入控制台',
                en: 'Open Console'
            }),
            ctaLink: String(config.cta_link || '').trim() || 'https://gongyi.zaoyoe.com',
            highlights: resolveLocalizedTextList(
                config.highlight_items,
                isEnglish ? ['Subscription to API', 'Session continuity', 'Usage billing'] : ['订阅转 API', '会话保持', '按量计费']
            ),
            featureCards: defaultCards.map((card, index) => {
                const baseKey = `feature_${index + 1}`;
                return {
                    title: resolveLocalizedText(getLocalizedField(config, `${baseKey}_title`), '', {
                        zh: card.title,
                        en: card.title
                    }),
                    description: resolveLocalizedText(getLocalizedField(config, `${baseKey}_description`), '', {
                        zh: card.description,
                        en: card.description
                    })
                };
            }),
            showModelSection: config.show_model_section !== false && visibleModelItems.length > 0,
            modelItems: visibleModelItems
        };
    }

    function buildVerifyData(config = {}) {
        const isEnglish = getCurrentLanguage() === 'en';
        const experimentCtaText = getSectionExperimentValue('verify', config, 'cta_text', '');
        const defaultFeatures = isEnglish
            ? [
                window.i18n?.t('home.verify.features.free') || 'Free',
                window.i18n?.t('home.verify.features.realtime') || 'Real-time',
                window.i18n?.t('home.verify.features.secure') || 'Secure'
            ]
            : [
                window.i18n?.t('home.verify.features.free') || '免费',
                window.i18n?.t('home.verify.features.realtime') || '实时',
                window.i18n?.t('home.verify.features.secure') || '安全'
            ];
        const defaultValueProps = isEnglish
            ? [
                window.i18n?.t('home.verify.valueProps.fast') || 'Second-level checks',
                window.i18n?.t('home.verify.valueProps.visible') || 'Visible process',
                window.i18n?.t('home.verify.valueProps.safe') || 'Traceable results'
            ]
            : [
                window.i18n?.t('home.verify.valueProps.fast') || '秒级校验',
                window.i18n?.t('home.verify.valueProps.visible') || '过程可见',
                window.i18n?.t('home.verify.valueProps.safe') || '结果可追踪'
            ];
        const defaultModels = ['Gemini', 'Claude', 'OpenAI'];
        const demoCostPoints = Number.parseInt(config.demo_cost_points, 10);
        return {
            title: resolveLocalizedText(getLocalizedField(config, 'section_title'), 'home.verify.title', {
                zh: 'Gemini 验证',
                en: 'Google One'
            }),
            subtitle: resolveLocalizedText(getLocalizedField(config, 'section_subtitle'), 'home.verify.subtitle', {
                zh: '快速验证您的 API 密钥',
                en: 'Submit account jobs and fetch trial links automatically'
            }),
            features: resolveLocalizedTextList(config.features, defaultFeatures),
            valueProps: resolveLocalizedTextList(config.value_props, defaultValueProps),
            supportedModels: Array.isArray(config.supported_models) && config.supported_models.length > 0
                ? config.supported_models
                : defaultModels,
            ctaText: resolveLocalizedText(experimentCtaText || config.cta_text, 'home.verify.cta', {
                zh: '立即验证',
                en: 'Verify Now'
            }),
            riskNotice: resolveLocalizedText(config.risk_notice, 'home.verify.riskNotice', {
                zh: '建议先使用测试账号完成校验，再切换正式账号。',
                en: 'Use a test account for the first check, then switch to a production account.'
            }),
            link: String(config.cta_link || '').trim() || '/verify.html?source=homepage_verify',
            screenshot: config.screenshot_path || '/assets/verify-preview.png',
            previewMode: String(config.preview_mode || 'dynamic').trim() === 'image' ? 'image' : 'dynamic',
            demo: {
                title: String(config.demo_title || '').trim() || 'Google One',
                subtitle: resolveLocalizedText(config.demo_subtitle, '', {
                    zh: '获取 1年 pro 权限的试用链接',
                    en: 'Get a one-year Pro trial link'
                }),
                email: String(config.demo_email || '').trim() || 'preview.account@gmail.com',
                totp: String(config.demo_totp || '').trim() || '3r6cu37xch4ej6d5',
                successLink: String(config.demo_success_link || '').trim() || 'https://services.sheerid.com/verify/zaoyoe-demo?verificationId=GO-8K21',
                quota: resolveLocalizedText(config.demo_quota, '', {
                    zh: '0.5 提 / 全 1',
                    en: '0.5 submit / 1 full'
                }),
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
                if (data?.language && data.language !== getCurrentLanguage()) {
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
            const { items: promptPool, source: promptPoolSource } = await fetchVisiblePromptPool();

            const [shopResult, guestbookMessages] = await Promise.all([
                window.supabaseClient
                    .from('shop_products')
                    .select('id, name, name_en, description, description_en, icon_url, price_points, price_points_intl, stock_count, category, display_order')
                    .eq('is_active', true)
                    .order('display_order', { ascending: false }),
                fetchHomepageGuestbookMessages(HOMEPAGE_GUESTBOOK_CARD_LIMIT)
            ]);

            if (shopResult.error) throw shopResult.error;

            const allProducts = Array.isArray(shopResult.data) ? shopResult.data : [];
            const prompts = aggregatePrompts(config.prompts || {}, promptPool);
            const shop = aggregateShop(config.shop || {}, allProducts);
            const guestbook = aggregateGuestbook(config.guestbook || {}, guestbookMessages);
            const ticker = {
                ...buildTickerData(config.ticker || {}, promptPool, shop),
                speed: config.ticker?.speed || 30,
                shopScrollSpeed: config.ticker?.shop_scroll_speed || config.ticker?.speed || 30
            };
            const cacheKind = promptPoolSource === 'live' ? 'complete' : 'partial';
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
                promptPool,
                sectionRows,
                sectionOrder,
                cacheKind,
                schemaVersion: HOMEPAGE_PREFETCH_SCHEMA_VERSION,
                language: getCurrentLanguage(),
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

    function shouldPrefetchHomepageFromLogo(anchor) {
        if (!(anchor instanceof HTMLAnchorElement)) {
            return false;
        }

        try {
            const url = new URL(anchor.href, window.location.origin);
            return url.origin === window.location.origin
                && (url.pathname === '/' || url.pathname === '/index.html');
        } catch (_error) {
            return false;
        }
    }

    document.addEventListener('mouseover', (e) => {
        if (shouldPrefetchGuestbook(e.target)) {
            prefetchGuestbookData();
            return;
        }

        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (shouldPrefetchHomepageFromLogo(logo)) checkAndPrefetch();
    });

    document.addEventListener('touchstart', (e) => {
        if (shouldPrefetchGuestbook(e.target)) {
            prefetchGuestbookData();
            return;
        }

        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (shouldPrefetchHomepageFromLogo(logo)) checkAndPrefetch();
    }, { passive: true });

    window._prefetchGuestbook = prefetchGuestbookData;
})();
