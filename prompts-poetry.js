// ========================================
// IMAGE OPTIMIZATION (Thumbnail URL Rule)
// ========================================
/**
 * Get optimized image URL by using pre-generated thumbnails
 * Thumbnails are stored at: /prompts/thumb/xxx.webp
 * Original images are at:   /prompts/xxx.webp
 * 
 * @param {string} url - Original image URL
 * @returns {string} Thumbnail URL for R2 CDN images, original for others
 */
function getOptimizedImageUrl(url, options = {}) {
    const { variant = '' } = options;
    const explicitVariantUrl = getPromptImageAssetVariantUrl(url, variant);
    if (explicitVariantUrl) {
        return normalizePromptCdnUrlForCurrentSite(explicitVariantUrl) || explicitVariantUrl;
    }

    const rawUrl = getPromptImageAssetOriginalUrl(url);
    if (!rawUrl) return '';

    const variantUrl = getPromptResponsiveImageVariantUrl(rawUrl, variant);
    if (variantUrl) {
        return variantUrl;
    }

    // R2 CDN images - use pre-generated thumbnails for direct original prompt images.
    const r2ThumbUrl = getPromptResponsiveR2VariantUrl(rawUrl, 'thumb');
    if (r2ThumbUrl && !hasPromptResponsiveVariantManifest()) {
        return r2ThumbUrl;
    }

    if (isSupabaseStorageImageUrl(rawUrl)) {
        return '';
    }

    // Return original URL for other images or already-thumbnail URLs
    return normalizePromptCdnUrlForCurrentSite(rawUrl) || rawUrl;
}

function isSupabaseStorageImageUrl(url) {
    return /^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i.test(String(url || '').trim());
}

function getPromptAssetCdnOrigin({ canonical = false } = {}) {
    if (canonical) {
        return String(window.SiteConfig?.getCanonicalAssetCdnOrigin?.() || 'https://cdn.zaoyoe.com').replace(/\/+$/, '');
    }

    const configuredOrigin = String(window.SiteConfig?.getAssetCdnOrigin?.() || '').trim();
    if (configuredOrigin) {
        return configuredOrigin.replace(/\/+$/, '');
    }

    const hostname = String(window.location?.hostname || '').toLowerCase();
    return hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz')
        ? 'https://cdn.zaoyoe.xyz'
        : 'https://cdn.zaoyoe.com';
}

function normalizePromptCdnUrlForCurrentSite(url, options = {}) {
    const source = String(url || '').trim();
    if (!source) return '';

    const siteConfigNormalizer = options.canonical
        ? window.SiteConfig?.normalizeAssetUrlForCanonicalSite
        : window.SiteConfig?.normalizeAssetUrlForCurrentSite;
    const normalizedBySiteConfig = typeof siteConfigNormalizer === 'function'
        ? String(siteConfigNormalizer.call(window.SiteConfig, source) || '').trim()
        : '';
    if (normalizedBySiteConfig && normalizedBySiteConfig !== source) {
        return normalizedBySiteConfig;
    }

    try {
        const parsed = new URL(source, window.location.origin);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isKnownCdnHost = ['cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname) || parsed.hostname.endsWith('.r2.dev');
        if (!isKnownCdnHost || parts[0] !== 'prompts') return '';

        const targetOrigin = new URL(getPromptAssetCdnOrigin(options));
        parsed.protocol = targetOrigin.protocol;
        parsed.host = targetOrigin.host;
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

function getPromptResponsiveImageFilename(url) {
    try {
        const parsed = new URL(String(url || '').trim(), window.location.origin);
        return decodeURIComponent(String(parsed.pathname || '').split('/').filter(Boolean).pop() || '');
    } catch (error) {
        return String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '';
    }
}

function getPromptResponsiveVariantList(variant = '') {
    const normalizedVariant = String(variant || '').trim();
    if (!normalizedVariant) return null;

    const manifest = window.__PROMPT_IMAGE_VARIANTS__ || null;
    const available = manifest?.variants?.[normalizedVariant];
    return Array.isArray(available) ? available : null;
}

function hasPromptResponsiveVariantManifest() {
    const manifest = window.__PROMPT_IMAGE_VARIANTS__ || null;
    return Boolean(manifest?.variants && typeof manifest.variants === 'object');
}

function hasPromptResponsiveImageVariant(url, variant = '') {
    const available = getPromptResponsiveVariantList(variant);
    if (!available) return false;

    const filename = getPromptResponsiveImageFilename(url);
    return Boolean(filename && available.includes(filename));
}

function getPromptResponsiveR2VariantUrl(url, variant = '') {
    const variantPath = { thumb: 'thumb', featured: 'featured', home: 'home', card: 'card' }[String(variant || '').trim()];
    if (!variantPath) return '';

    try {
        const normalizedUrl = normalizePromptCdnUrlForCurrentSite(url) || String(url || '').trim();
        const parsed = new URL(normalizedUrl, window.location.origin);
        if (!['cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)) return '';

        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        if (parts.length !== 2 || parts[0] !== 'prompts') return '';

        const filename = decodeURIComponent(parts[1] || '');
        if (!filename) return '';

        return `${getPromptAssetCdnOrigin()}/prompts/${variantPath}/${encodeURIComponent(filename)}`;
    } catch (error) {
        return '';
    }
}

function getPromptResponsiveImageVariantUrl(url, variant = '') {
    const normalizedVariant = String(variant || '').trim();
    const trimmed = String(url || '').trim();
    const normalizedUrl = normalizePromptCdnUrlForCurrentSite(trimmed) || '';
    if (!normalizedVariant || !normalizedUrl) {
        return '';
    }

    const available = getPromptResponsiveVariantList(normalizedVariant);
    if (Array.isArray(available)) {
        const filename = getPromptResponsiveImageFilename(normalizedUrl);
        if (filename && available.includes(filename)) {
            const manifest = window.__PROMPT_IMAGE_VARIANTS__ || null;
            const basePath = String(manifest?.basePaths?.[normalizedVariant] || `/assets/prompts-${normalizedVariant}`).replace(/\/+$/, '');
            return `${basePath}/${encodeURIComponent(filename)}`;
        }
        return '';
    }

    return getPromptResponsiveR2VariantUrl(normalizedUrl, normalizedVariant);
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

function getPromptImageAssetVariantUrl(value, variant = '') {
    const normalizedVariant = String(variant || '').trim();
    if (!normalizedVariant || typeof value === 'string') {
        return '';
    }

    const asset = normalizePromptImageAsset(value);
    if (!asset) return '';
    return String(asset[normalizedVariant] || '').trim();
}

function getPromptImageAssetOriginalUrl(value) {
    const asset = normalizePromptImageAsset(value);
    if (!asset) return '';
    return String(asset.original || asset.featured || asset.card || asset.home || asset.thumb || '').trim();
}

function normalizePromptImageAssetsFromRecord(record = {}) {
    const explicitAssets = Array.isArray(record?.imageAssets)
        ? record.imageAssets
        : (Array.isArray(record?.image_assets) ? record.image_assets : []);
    const legacyImages = Array.isArray(record?.images) ? record.images : [];
    const assets = [];
    const seen = new Set();

    for (const source of [...explicitAssets, ...legacyImages]) {
        const asset = normalizePromptImageAsset(source);
        if (!asset) continue;

        const key = getPromptImageAssetOriginalUrl(asset);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        assets.push(asset);
    }

    return assets;
}

function getPromptImageAssets(item = {}) {
    return normalizePromptImageAssetsFromRecord(item);
}

function getPromptPrimaryImageAsset(item = {}) {
    return getPromptImageAssets(item)[0] || null;
}

function getPromptModalImageUrl(url) {
    const trimmed = getPromptImageAssetOriginalUrl(url);
    if (!trimmed) return '';
    if (isSupabaseStorageImageUrl(trimmed)) return '';
    const displayUrl = normalizePromptCdnUrlForCurrentSite(trimmed) || trimmed;

    try {
        const parsed = new URL(displayUrl, window.location.origin);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);

        const isPromptCdnHost = ['cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname) || parsed.hostname.endsWith('.r2.dev');
        if (isPromptCdnHost && parts.length === 3 && parts[0] === 'prompts' && ['thumb', 'featured', 'card', 'home'].includes(parts[1])) {
            parsed.pathname = `/prompts/${parts[2]}`;
            parsed.search = '';
            parsed.hash = '';
            return normalizePromptCdnUrlForCurrentSite(parsed.toString()) || parsed.toString();
        }

    } catch (error) {
        return displayUrl;
    }

    return displayUrl;
}

function shouldForcePromptPageTop() {
    if (!window.__PROMPTS_FORCE_SCROLL_TOP__) return false;

    const urlParams = new URLSearchParams(window.location.search);
    return !urlParams.has('id') && !window.location.hash;
}

function forcePromptPageTop() {
    if (!shouldForcePromptPageTop()) return;

    const forceTop = typeof window.__PROMPTS_FORCE_SCROLL_TOP_FN__ === 'function'
        ? window.__PROMPTS_FORCE_SCROLL_TOP_FN__
        : () => {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        };

    forceTop();
    requestAnimationFrame(forceTop);
}

function syncPromptNavOffset() {
    const nav = document.querySelector('.framer-nav');
    if (!nav) return;

    const applyNavHeight = () => {
        const navHeight = Math.round(nav.getBoundingClientRect().height);
        if (navHeight > 0) {
            setPromptsCssVars(document.documentElement, {
                '--prompts-nav-height': `${navHeight}px`
            });
        }
    };

    applyNavHeight();

    if (nav._promptNavOffsetSynced) return;

    window.addEventListener('resize', applyNavHeight, { passive: true });
    window.addEventListener('load', applyNavHeight, { once: true });

    if (typeof ResizeObserver !== 'undefined') {
        const navResizeObserver = new ResizeObserver(applyNavHeight);
        navResizeObserver.observe(nav);
        nav._promptNavResizeObserver = navResizeObserver;
    }

    nav._promptNavOffsetSynced = true;
}

// --- Theme Toggle ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme(event) {
    // Prevent dropdown from closing when clicking the toggle
    if (event) {
        event.stopPropagation();
    }

    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');

    if (currentTheme === 'dark') {
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        void loadPromptStarrySkyRuntime({ force: true });
    }
}

// ========================================
// AVATAR MENU SYSTEM
// ========================================
const ADMIN_EMAIL = 'zaoyoe@gmail.com';
let isAdmin = false;

// ========================================
// INTERNATIONALIZATION (i18n) HELPERS
// ========================================
// Get current language preference (defaults to Chinese)
function getCurrentLanguage() {
    // Check localStorage first (user preference) - must match i18n.js key
    const saved = localStorage.getItem('zaoyoe_language');
    if (saved) return saved;

    // Fall back to browser language
    const browserLang = navigator.language || navigator.userLanguage;
    return browserLang.startsWith('en') ? 'en' : 'zh';
}

function containsPromptCjkText(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
}

function countPromptTextMatches(value, pattern) {
    return (String(value || '').match(pattern) || []).length;
}

function isPromptMostlyCjkText(value) {
    const text = String(value || '');
    const cjkCount = countPromptTextMatches(text, /[\u3400-\u9fff\uf900-\ufaff]/g);
    if (!cjkCount) return false;

    const latinCount = countPromptTextMatches(text, /[A-Za-z]/g);
    if (!latinCount) return true;

    const languageSignalCount = cjkCount + latinCount;
    return cjkCount >= 4 && (cjkCount / languageSignalCount) >= 0.35;
}

function shouldUsePromptEnglishUnavailableFallback(value, field) {
    if (!containsPromptCjkText(value)) return false;
    return field === 'prompt_text' ? isPromptMostlyCjkText(value) : true;
}

function getPromptFieldFallback(field) {
    const lang = getCurrentLanguage();
    if (lang !== 'en') {
        return '';
    }
    if (field === 'description') {
        return window.i18n?.t('gallery.noDescription') || 'No description available';
    }
    if (field === 'prompt_text') {
        return window.i18n?.t('gallery.promptUnavailable') || 'Prompt content is not available in English.';
    }
    return 'Prompt';
}

function resolvePromptLocalizedDataText(value, field) {
    const normalized = String(value || '').trim();
    if (getCurrentLanguage() === 'en' && shouldUsePromptEnglishUnavailableFallback(normalized, field)) {
        return getPromptFieldFallback(field);
    }
    return normalized || getPromptFieldFallback(field);
}

// Get localized field from prompt data
// @param {Object} item - Prompt object
// @param {string} field - Base field name (e.g., 'title', 'description', 'prompt_text')
// @returns {string} - Localized value or fallback to default
function getLocalizedField(item, field) {
    const lang = getCurrentLanguage();
    const localizedKey = `${field}_${lang}`;
    const otherLangKey = `${field}_${lang === 'en' ? 'zh' : 'en'}`;

    // Priority 1: Try current language field
    if (item[localizedKey] && item[localizedKey].trim()) {
        return resolvePromptLocalizedDataText(item[localizedKey], field);
    }

    if (lang !== 'en' && item[otherLangKey] && item[otherLangKey].trim()) {
        return resolvePromptLocalizedDataText(item[otherLangKey], field);
    }

    return resolvePromptLocalizedDataText(item[field], field);
}

const PROMPT_HOT_TAG_LIMIT = 10;
const PROMPT_AI_PAIRED_TAG_FIELDS = Object.freeze(['objects', 'scenes', 'styles', 'mood']);

function getPromptAiTags(item = {}) {
    const aiTags = item?.aiTags || item?.ai_tags;
    return aiTags && typeof aiTags === 'object' ? aiTags : {};
}

function normalizePromptTagText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePromptSearchText(value = '') {
    const rawValue = String(value || '');
    const normalizedValue = typeof rawValue.normalize === 'function' ? rawValue.normalize('NFKC') : rawValue;
    return normalizedValue
        .toLowerCase()
        .replace(/[氣気]/g, '气')
        .replace(/の/g, '之')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasPromptSearchSignal(value = '') {
    const normalized = normalizePromptSearchText(value).replace(/\s+/g, '');
    return normalized.length >= 2 || /[\u3400-\u9fff\uf900-\ufaff]/.test(normalized);
}

function collectPromptSearchValues(value, output = []) {
    if (value === null || value === undefined) {
        return output;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const normalized = normalizePromptSearchText(value);
        if (normalized) {
            output.push(normalized);
        }
        return output;
    }

    if (Array.isArray(value)) {
        value.forEach((item) => collectPromptSearchValues(item, output));
        return output;
    }

    if (typeof value === 'object') {
        Object.values(value).forEach((item) => collectPromptSearchValues(item, output));
    }

    return output;
}

function getPromptSearchTokenVariants(value = '') {
    const normalized = normalizePromptSearchText(value);
    if (!normalized) return [];

    const tokens = new Set([normalized]);
    normalized
        .split(/[\s,，、\/|;；:：()[\]{}<>《》"'“”‘’]+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => tokens.add(token));

    return Array.from(tokens).filter(hasPromptSearchSignal);
}

function getPromptSearchHaystack(item = {}) {
    return collectPromptSearchValues({
        title: item?.title,
        title_en: item?.title_en,
        title_zh: item?.title_zh,
        tags: item?.tags,
        description: item?.description,
        description_en: item?.description_en,
        description_zh: item?.description_zh,
        prompt: item?.prompt,
        prompt_text: item?.prompt_text,
        prompt_text_en: item?.prompt_text_en,
        prompt_text_zh: item?.prompt_text_zh,
        aiTags: item?.aiTags || item?.ai_tags,
        dominantColors: item?.dominantColors || item?.dominant_colors
    }).join(' ');
}

function escapePromptSearchRegExp(value = '') {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPromptSearchCjkChars(value = '') {
    return Array.from(String(value || '').matchAll(/[\u3400-\u9fff\uf900-\ufaff]/g), (match) => match[0]);
}

const PROMPT_SEARCH_CONTROLLED_SINGLE_CJK_TERMS = new Set(['枪', '蛇']);

function isPromptSearchSingleCjkTerm(value = '') {
    const normalized = normalizePromptSearchText(value).replace(/\s+/g, '');
    return normalized.length === 1 && getPromptSearchCjkChars(normalized).length === 1;
}

function isPromptSearchControlledSingleCjkTerm(value = '') {
    const normalized = normalizePromptSearchText(value).replace(/\s+/g, '');
    return isPromptSearchSingleCjkTerm(normalized) && PROMPT_SEARCH_CONTROLLED_SINGLE_CJK_TERMS.has(normalized);
}

function shouldPromptSearchUsePartialIndexTerm(term = '') {
    return hasPromptSearchSignal(term) && !isPromptSearchSingleCjkTerm(term);
}

function shouldPromptSearchUseBodyTerm(term = '') {
    return hasPromptSearchSignal(term) && (!isPromptSearchSingleCjkTerm(term) || isPromptSearchControlledSingleCjkTerm(term));
}

function shouldPromptSearchUseAiFallback(term = '') {
    return hasPromptSearchSignal(term) && !isPromptSearchSingleCjkTerm(term);
}

function shouldPromptSearchHydrateDetails(term = '') {
    return hasPromptSearchSignal(term) && (!isPromptSearchSingleCjkTerm(term) || isPromptSearchControlledSingleCjkTerm(term));
}

function promptSearchCjkFuzzyMatches(haystack = '', term = '') {
    const termChars = getPromptSearchCjkChars(term);
    if (termChars.length < 4) return false;

    const haystackChars = getPromptSearchCjkChars(haystack);
    if (haystackChars.length < termChars.length - 1) return false;

    const requiredCount = Math.max(3, termChars.length - 1);
    const compactHaystack = haystackChars.join('');

    for (let omittedIndex = 0; omittedIndex < termChars.length; omittedIndex += 1) {
        const omittedChars = termChars.filter((_, index) => index !== omittedIndex);
        if (omittedChars.length >= requiredCount && compactHaystack.includes(omittedChars.join(''))) {
            return true;
        }
    }

    return false;
}

function promptSearchHaystackMatchesTerm(haystack = '', term = '') {
    const normalizedHaystack = normalizePromptSearchText(haystack);
    const normalizedTerm = normalizePromptSearchText(term);
    if (!normalizedHaystack || !normalizedTerm) return false;

    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(normalizedTerm)) {
        return normalizedHaystack.includes(normalizedTerm)
            || promptSearchCjkFuzzyMatches(normalizedHaystack, normalizedTerm);
    }

    const termPattern = escapePromptSearchRegExp(normalizedTerm).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${termPattern}(?=$|[^a-z0-9])`, 'i').test(normalizedHaystack);
}

function pushUniquePromptTag(target, value, seen = new Set()) {
    const normalized = normalizePromptTagText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
        return;
    }
    seen.add(key);
    target.push(normalized);
}

function getPromptPlainTagList(values = []) {
    if (!Array.isArray(values)) {
        return [];
    }

    const seen = new Set();
    const output = [];
    values.forEach((value) => pushUniquePromptTag(output, value, seen));
    return output;
}

function getLocalizedPromptPairedTags(tagData = {}) {
    if (!tagData || typeof tagData !== 'object') {
        return [];
    }

    const lang = getCurrentLanguage();
    const primaryTags = Array.isArray(tagData[lang]) ? tagData[lang] : [];
    const fallbackTags = Array.isArray(tagData[lang === 'zh' ? 'en' : 'zh'])
        ? tagData[lang === 'zh' ? 'en' : 'zh']
        : [];
    const maxLength = Math.max(primaryTags.length, fallbackTags.length);
    const output = [];
    const seen = new Set();

    for (let index = 0; index < maxLength; index += 1) {
        const nextTag = primaryTags[index] || (lang === 'en' ? '' : fallbackTags[index]);
        pushUniquePromptTag(output, nextTag, seen);
    }

    return output;
}

function getPromptDifficultyLabel(value = '') {
    const key = normalizePromptTagText(value).toLowerCase();
    const isZh = getCurrentLanguage() === 'zh';
    const labels = {
        beginner: isZh ? '新手友好' : 'Beginner friendly',
        intermediate: isZh ? '进阶' : 'Intermediate',
        advanced: isZh ? '专业级' : 'Advanced'
    };
    return labels[key] || normalizePromptTagText(value);
}

function collectPromptAiHotTags(prompt = {}) {
    const aiTags = getPromptAiTags(prompt);
    const output = [];
    const seen = new Set();

    PROMPT_AI_PAIRED_TAG_FIELDS.forEach((field) => {
        getLocalizedPromptPairedTags(aiTags[field]).forEach((tag) => pushUniquePromptTag(output, tag, seen));
    });

    [
        aiTags.useCase?.platform,
        aiTags.useCase?.purpose,
        aiTags.useCase?.format,
        aiTags.commercial?.niche,
        aiTags.commercial?.targetAudience
    ].forEach((values) => {
        getPromptPlainTagList(values).forEach((tag) => pushUniquePromptTag(output, tag, seen));
    });

    const difficultyLabel = getPromptDifficultyLabel(aiTags.difficulty);
    if (difficultyLabel) {
        pushUniquePromptTag(output, difficultyLabel, seen);
    }

    return output;
}

function addPromptHotTagsToFrequency(prompt = {}, tagFreq = {}) {
    if (Array.isArray(prompt.tags)) {
        prompt.tags.forEach((tag) => {
            const normalized = normalizePromptTagText(tag);
            if (normalized) {
                tagFreq[normalized] = (tagFreq[normalized] || 0) + 1;
            }
        });
    }

    collectPromptAiHotTags(prompt).forEach((tag) => {
        tagFreq[tag] = (tagFreq[tag] || 0) + 1;
    });

    return tagFreq;
}

function buildPromptHotTags(prompts = [], limit = PROMPT_HOT_TAG_LIMIT) {
    const tagFreq = {};
    prompts.forEach((prompt) => addPromptHotTagsToFrequency(prompt, tagFreq));
    return Object.entries(tagFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([tag]) => tag);
}

// ========================================
// SEARCH OPTIMIZATION CONFIG
// ========================================
// Gemini 2.0 Flash for semantic search (high RPD: 1,500/day)
const GEMINI_2_0_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// AI Search Rate Limiting
const AI_SEARCH_RATE_LIMIT = {
    maxPerMinute: 3,           // Max AI searches per minute for regular users
    windowMs: 60000,           // 1 minute window
    userSearchHistory: [],     // Timestamps of AI searches
    cooldownShown: false       // Prevent duplicate cooldown messages
};

// Hot tags cache (computed once on init)
let HOT_TAGS_CACHE = null;

// ==================== 敏感词过滤（画廊版本）====================
let gallerySensitiveWordsCache = null;
let gallerySensitiveWordsCacheTime = null;

async function loadGallerySensitiveWords() {
    // Cache for 5 minutes
    if (gallerySensitiveWordsCache && gallerySensitiveWordsCacheTime && (Date.now() - gallerySensitiveWordsCacheTime < 300000)) {
        return gallerySensitiveWordsCache;
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'moderation')
            .single();

        if (error || !data) {
            gallerySensitiveWordsCache = { enabled: false, words: [] };
        } else {
            gallerySensitiveWordsCache = {
                enabled: data.config_value?.auto_filter || false,
                words: data.config_value?.sensitive_words || []
            };
        }
        gallerySensitiveWordsCacheTime = Date.now();
        console.log('📋 [Gallery] 敏感词配置已加载:', gallerySensitiveWordsCache.words.length, '个词');
        return gallerySensitiveWordsCache;
    } catch (e) {
        console.warn('[Gallery] 加载敏感词配置失败:', e);
        return { enabled: false, words: [] };
    }
}

async function checkGallerySensitiveContent(content) {
    const config = await loadGallerySensitiveWords();

    if (!config.enabled || !config.words.length) {
        return { blocked: false };
    }

    const lowerContent = content.toLowerCase();
    for (const word of config.words) {
        if (lowerContent.includes(word.toLowerCase())) {
            return { blocked: true, word: word };
        }
    }

    return { blocked: false };
}

// ==================== 自定义 Toast 通知 ====================
function showGalleryToast(message, type = 'warning', duration = 3000) {
    // Remove existing toast if any
    const existingToast = document.querySelector('.gallery-toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Icon mapping
    const icons = {
        warning: 'fas fa-exclamation-triangle',
        error: 'fas fa-times-circle',
        success: 'fas fa-check-circle',
        info: 'fas fa-info-circle'
    };

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `gallery-toast gallery-toast--${type}`;
    toast.innerHTML = `
        <i class="gallery-toast__icon ${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.add('gallery-toast--visible');
    });

    // Auto dismiss
    setTimeout(() => {
        toast.classList.remove('gallery-toast--visible');
        toast.classList.add('gallery-toast--exiting');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

function setPromptsHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle('prompts-hidden', Boolean(hidden));
}

function setPromptsDisplayState(element, visible, displayClass) {
    if (!element) return;
    element.classList.toggle('prompts-hidden', !visible);
    if (displayClass) {
        element.classList.toggle(displayClass, Boolean(visible));
    }
}

function buildPromptsStaggerClass(index) {
    return `prompts-stagger-${Math.min(Math.max(Number(index) || 0, 0), 5)}`;
}

function beginPromptsNavTransition(navContainer, hiddenClass) {
    if (!navContainer) return;
    navContainer.classList.add('prompts-nav-transition');
    navContainer.classList.remove('prompts-nav-hidden-up', 'prompts-nav-hidden-down');
    if (hiddenClass) {
        navContainer.classList.add(hiddenClass);
    }
}

function finishPromptsNavTransition(navContainer, hiddenClass) {
    if (!navContainer) return;
    navContainer.classList.remove('prompts-nav-hidden-up', 'prompts-nav-hidden-down');
    if (hiddenClass) {
        navContainer.classList.add(hiddenClass);
    }
    requestAnimationFrame(() => {
        navContainer.classList.remove('prompts-nav-hidden-up', 'prompts-nav-hidden-down');
    });
}

function setPromptCardStaggerClass(card, index) {
    if (!card) return;
    const nextClass = `prompt-card-stagger-${Math.min(Math.max(Number(index) || 0, 0), 11)}`;
    const previousClass = card.dataset.promptCardStaggerClass;
    if (previousClass && previousClass !== nextClass) {
        card.classList.remove(previousClass);
    }
    card.dataset.promptCardStaggerClass = nextClass;
    card.classList.add(nextClass);
}

function clearPromptCardHideTimer(card) {
    if (!card?.__promptCardHideTimer) return;
    clearTimeout(card.__promptCardHideTimer);
    card.__promptCardHideTimer = null;
}

function showPromptCard(card, index = 0) {
    if (!card) return;
    clearPromptCardHideTimer(card);
    setPromptsHidden(card, false);
    card.classList.remove('prompt-card-exiting', 'card-visible');
    setPromptCardStaggerClass(card, index);
    requestAnimationFrame(() => {
        card.classList.add('card-visible');
    });
}

function hidePromptCard(card, animated = false) {
    if (!card) return;
    clearPromptCardHideTimer(card);
    card.classList.remove('card-visible');
    if (!animated) {
        card.classList.remove('prompt-card-exiting');
        setPromptsHidden(card, true);
        return;
    }

    card.classList.add('prompt-card-exiting');
    card.__promptCardHideTimer = setTimeout(() => {
        card.classList.remove('prompt-card-exiting');
        setPromptsHidden(card, true);
        card.__promptCardHideTimer = null;
    }, 300);
}

function setPromptsCssVars(element, entries) {
    if (!element || !entries) return;
    const styleDecl = element.style;
    if (!styleDecl) return;
    Object.entries(entries).forEach(([name, value]) => {
        if (value === null || value === undefined || value === '') {
            styleDecl['removeProperty'](name);
            return;
        }
        styleDecl['setProperty'](name, String(value));
    });
}

function refreshPromptsTextareaCaret(input) {
    if (!input || document.activeElement !== input || typeof input.setSelectionRange !== 'function') return;

    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    const selectionDirection = input.selectionDirection || 'none';

    requestAnimationFrame(() => {
        if (!input.isConnected || document.activeElement !== input) return;
        try {
            input.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
        } catch (_) {
            return;
        }

        input.classList.add('prompts-caret-repaint');
        requestAnimationFrame(() => {
            input.classList.remove('prompts-caret-repaint');
        });
    });
}

function getPromptsPageOverflowState() {
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    return {
        htmlOverflow: htmlStyle?.['getPropertyValue']('overflow'),
        bodyOverflow: bodyStyle?.['getPropertyValue']('overflow')
    };
}

function setPromptsPageOverflow(value) {
    setPromptsCssVars(document.documentElement, {
        overflow: value
    });
    setPromptsCssVars(document.body, {
        overflow: value
    });
}

function resetPromptsTextareaAutoHeight(element) {
    if (!element) return;
    setPromptsCssVars(element, {
        height: 'auto',
        'overflow-y': 'hidden'
    });
}

function applyPromptsTextareaAutoHeight(element, maxHeight, minHeight = 0) {
    if (!element) return;
    resetPromptsTextareaAutoHeight(element);
    const targetHeight = Math.max(minHeight, Math.min(element.scrollHeight, maxHeight));
    setPromptsCssVars(element, {
        height: `${targetHeight}px`,
        'overflow-y': element.scrollHeight > targetHeight ? 'auto' : 'hidden'
    });
}

function setCommentCollapseVisibility(allComments, collapsed) {
    let shownParents = 0;

    allComments.forEach((comment) => {
        const isParent = !comment.classList.contains('comment-reply');
        let shouldHide = false;

        if (collapsed) {
            shouldHide = isParent ? shownParents >= COLLAPSE_SHOW_COUNT : true;
            if (isParent && !shouldHide) {
                shownParents++;
            }
        }

        comment.classList.toggle('hidden-collapsed', shouldHide);
    });
}

// Inverted search index for O(1) tag lookups (built on init)
// Structure: { "tag_lowercase": [promptIndex1, promptIndex2, ...] }
let SEARCH_INDEX = null;
let SEARCH_INDEX_PROMPTS_REF = null;
let SEARCH_INDEX_PROMPTS_LENGTH = 0;
let PROMPT_SEARCH_REQUEST_ID = 0;

function invalidatePromptSearchCaches() {
    SEARCH_INDEX = null;
    SEARCH_INDEX_PROMPTS_REF = null;
    SEARCH_INDEX_PROMPTS_LENGTH = 0;
    HOT_TAGS_CACHE = null;
}

/**
 * Build inverted search index for all searchable content
 * Called once during initialization for O(1) lookups
 */
function buildSearchIndex() {
    if (SEARCH_INDEX && SEARCH_INDEX_PROMPTS_REF === PROMPTS && SEARCH_INDEX_PROMPTS_LENGTH === PROMPTS.length) return;
    if (typeof PROMPTS === 'undefined' || PROMPTS.length === 0) return;

    console.log('🔍 Building search index...');
    SEARCH_INDEX = {};

    PROMPTS.forEach((p, index) => {
        if (!p) return;
        const searchId = p.id ?? index;

        const addToIndex = (term) => {
            const key = normalizePromptSearchText(term);
            if (!hasPromptSearchSignal(key)) return;
            if (!SEARCH_INDEX[key]) SEARCH_INDEX[key] = [];
            if (!SEARCH_INDEX[key].includes(searchId)) {
                SEARCH_INDEX[key].push(searchId);
            }
        };

        collectPromptSearchValues({
            title: p.title,
            title_en: p.title_en,
            title_zh: p.title_zh,
            tags: p.tags,
            aiTags: p.aiTags || p.ai_tags,
            dominantColors: p.dominantColors || p.dominant_colors
        }).forEach((value) => {
            getPromptSearchTokenVariants(value).forEach(addToIndex);
        });
    });

    SEARCH_INDEX_PROMPTS_REF = PROMPTS;
    SEARCH_INDEX_PROMPTS_LENGTH = PROMPTS.length;
    console.log(`✅ Search index built: ${Object.keys(SEARCH_INDEX).length} terms`);
}

/**
 * Fast index-based search (O(1) per term)
 * @param {string} query - Search query
 * @returns {Set<number>} - Set of matching prompt indices
 */
function searchByIndex(query) {
    if (!SEARCH_INDEX) buildSearchIndex();
    if (!SEARCH_INDEX) return new Set();

    const terms = getPromptSearchTokenVariants(query);
    let results = null;

    terms.forEach(term => {
        // Direct match
        const directMatches = new Set(SEARCH_INDEX[term] || []);

        // Partial match (for terms that are substrings)
        if (shouldPromptSearchUsePartialIndexTerm(term)) {
            Object.keys(SEARCH_INDEX).forEach(indexedTerm => {
                if (indexedTerm.includes(term) || term.includes(indexedTerm)) {
                    SEARCH_INDEX[indexedTerm].forEach(id => directMatches.add(id));
                }
            });
        }

        if (results === null) {
            results = directMatches;
        } else {
            // Intersect for multi-word queries
            results = new Set([...results].filter(id => directMatches.has(id)));
        }
    });

    return results || new Set();
}

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
    'snake': ['serpent', 'cobra', 'viper', 'python', 'reptile', '蛇', '毒蛇', '眼镜蛇', '蟒蛇', '爬行动物'],
    'gun': ['枪', '枪械', '火器', '手枪', '步枪', '机枪', '狙击枪', '机械枪', 'rifle', 'pistol', 'firearm'],
    '裙子': ['连衣裙', '半身裙', '长裙', '短裙', '公主裙', '礼服裙', '洛丽塔裙'],
    'water': ['水', '水面', '水流', '水滴', '水下', '水花', '水波', '海水', '河流', '溪流', '湖泊', '瀑布', '雨水'],

    // === Platform/Use case synonyms ===
    '小红书': ['xiaohongshu', 'xhs', 'red', '种草', 'rednote', '小红书封面'],
    'instagram': ['ins', 'ig', 'insta', 'gram'],
    'wallpaper': ['壁纸', 'background', '背景图', '锁屏', '桌面', '手机壁纸'],
    'avatar': ['头像', 'profile picture', 'pfp', '头图', 'icon'],
    'poster': ['海报', 'banner', '宣传图', '封面'],
    'cover': ['封面', 'thumbnail', '首图', '缩略图'],
    '抖音': ['douyin', 'tiktok', '抖音头图', '短视频'],
    '公众号': ['wechat', 'weixin', '微信公众号', '公众号配图'],
    '淘宝': ['taobao', 'ecommerce', '电商', '淘宝主图', '主图'],

    // === Purpose/Use synonyms ===
    '电商卖货': ['ecommerce', 'selling', '卖货', '带货', '商品'],
    '品牌营销': ['branding', 'marketing', '品牌', '营销推广'],
    '个人IP': ['personal brand', 'ip', '人设', '自媒体'],
    '知识付费': ['course', 'education', '课程', '付费内容'],
    '表情包': ['sticker', 'emoji', 'meme', '贴纸'],
    '自媒体配图': ['blog', 'article', '文章配图', '推文'],

    // === Commercial niche synonyms ===
    '母婴': ['baby', 'parenting', 'mom', '宝宝', '育儿', '亲子'],
    '美妆': ['beauty', 'makeup', 'cosmetic', '化妆', '护肤', '彩妆'],
    '健身': ['fitness', 'gym', 'workout', '运动', '减肥', '塑形'],
    '旅游': ['travel', 'trip', 'vacation', '旅行', '出游', '度假'],
    '教育': ['education', 'learning', 'study', '学习', '培训', '考试'],
    '宠物': ['pet', 'cat', 'dog', '猫', '狗', '萌宠'],
    '家居': ['home', 'interior', 'decor', '装修', '居家', '生活'],
    '时尚': ['fashion', 'style', 'outfit', '穿搭', '潮流', '服饰'],
    '游戏': ['game', 'gaming', 'esports', '电竞', '玩家'],
    '情感': ['emotion', 'love', 'relationship', '恋爱', '情侣', '心理'],

    // === Target audience synonyms ===
    'Z世代': ['gen z', 'genz', '00后', '年轻人', '学生'],
    '职场女性': ['career woman', 'office', '白领', '打工人'],
    '新手妈妈': ['new mom', 'mommy', '宝妈', '准妈妈'],
    '文艺青年': ['artsy', 'artistic', '文青', '小众'],
    '二次元': ['anime', 'acg', '动漫', '宅'],

    // === Difficulty synonyms ===
    '新手友好': ['beginner', 'easy', 'simple', '入门', '简单'],
    '进阶': ['intermediate', 'advanced', '中级', '提高'],
    '专业级': ['professional', 'expert', 'pro', '高级', '专业'],

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

    // === Nature synonyms ===
    'leaf': ['leaves', 'foliage', '树叶', '叶子', '叶片', '绿叶'],
    'flower': ['floral', 'bloom', 'blossom', '花', '花卉', '鲜花'],
    'tree': ['forest', 'woods', '树', '森林', '树木'],
    'mountain': ['hill', 'peak', '山', '山脉', '峰'],
    'ocean': ['sea', 'water', 'wave', 'beach', '海', '海洋', '海浪', '海滩'],
    'sky': ['cloud', 'starry', '天空', '云', '星空'],
    'snow': ['winter', 'ice', '雪', '冬', '冰'],
    'rain': ['rainy', '雨', '下雨'],

    // === Transport synonyms ===
    'bicycle': ['bike', 'cycling', '自行车', '单车', '脚踏车', '骑行'],
    'car': ['vehicle', 'auto', '汽车', '轿车', '车'],

    // === People synonyms ===
    'girl': ['woman', 'female', 'lady', '女孩', '女生', '女性'],
    'boy': ['man', 'male', 'guy', '男孩', '男生', '男性'],
    'child': ['kid', 'baby', '儿童', '小孩', '宝宝']
};

function getAvatarMenuElements() {
    return {
        dropdown: document.getElementById('avatarDropdown') || document.getElementById('userDropdown'),
        overlay: document.getElementById('dropdownOverlay'),
        trigger: document.getElementById('userAvatarContainer') || document.getElementById('authBtn')
    };
}

function toggleAvatarMenu(forceOpen = null) {
    const { dropdown, overlay } = getAvatarMenuElements();
    if (!dropdown) return false;

    const nextState = typeof forceOpen === 'boolean'
        ? forceOpen
        : !dropdown.classList.contains('active');

    dropdown.classList.toggle('active', nextState);
    overlay?.classList.toggle('active', nextState);
    return nextState;
}

function closeAvatarMenu() {
    return toggleAvatarMenu(false);
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const { trigger, dropdown, overlay } = getAvatarMenuElements();
    if (!dropdown) return;

    const clickedInsideDropdown = dropdown.contains(e.target);
    const clickedTrigger = !!(trigger && trigger.contains(e.target));
    if (!clickedInsideDropdown && !clickedTrigger) {
        dropdown.classList.remove('active');
        overlay?.classList.remove('active');
    }
});

// Check auth state and update UI
async function checkAuthState() {
    if (!window.supabaseClient) return;

    try {
        const { data: { user } } = await window.supabaseClient.auth.getUser();

        const identityName = document.querySelector('.identity-name');
        const avatarBtn = document.getElementById('userAvatarBtn');
        const loginBtn = document.getElementById('loginBtn');
        const profileBtn = document.getElementById('profileBtn');
        const walletBtn = document.getElementById('walletBtn');
        const switchAccountBtn = document.getElementById('switchAccountBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const adminStudioBtn = document.getElementById('adminStudioBtn');

        if (user) {
            // User is logged in
            const displayName = user.email.split('@')[0];

            // Check admin via RPC (supports dynamic admins)
            try {
                const { data: isAdminResult } = await window.supabaseClient.rpc('is_admin');
                isAdmin = isAdminResult === true;
            } catch (e) {
                // Fallback to hardcoded email if RPC fails
                isAdmin = user.email === ADMIN_EMAIL;
            }

            // Force allow Super Admins (in case DB function is not updated)
            if (['fjivvid@163.com', 'zaoyoe@gmail.com'].includes(user.email)) {
                isAdmin = true;
            }

            if (isAdmin) {
                window.ZaoyoeAdminPresence?.start?.(window.supabaseClient);
            } else {
                window.ZaoyoeAdminPresence?.stop?.();
            }

            if (identityName) {
                identityName.innerHTML = isAdmin
                    ? `${displayName} <span class="admin-badge">✨</span>`
                    : displayName;
            }

            // 🆕 Fetch profile from database to get custom avatar
            let customAvatarUrl = null;
            try {
                const { data: profile, error } = await window.supabaseClient
                    .from('profiles')
                    .select('avatar_url')
                    .eq('id', user.id)
                    .single();

                console.log('📷 Profile avatar check:', {
                    hasProfile: !!profile,
                    avatarUrl: profile?.avatar_url ? profile.avatar_url.substring(0, 50) + '...' : 'NULL',
                    error: error?.message
                });

                // Check if avatar is valid AND has sufficient data content (prevent 1x1 pixel images)
                // A 1x1 pixel base64 png is usually very short (~60-80 chars). A real avatar is much larger.
                const MIN_BASE64_LENGTH = 100;

                if (!error && profile?.avatar_url && profile.avatar_url.trim() !== '') {
                    const url = profile.avatar_url;
                    let isValid = false;

                    if (url.startsWith('http')) {
                        isValid = true;
                    } else if (url.startsWith('data:')) {
                        // Check base64 length to filter out broken/empty images
                        if (url.length > MIN_BASE64_LENGTH) {
                            isValid = true;
                        } else {
                            console.warn('⚠️ Ignored invalid/too small base64 avatar:', url.substring(0, 50) + '...');
                        }
                    }

                    if (isValid) {
                        customAvatarUrl = url;
                        console.log('✅ Using custom avatar from profiles table');
                    }
                }
            } catch (e) {
                console.warn('Could not fetch profile avatar:', e);
            }

            if (avatarBtn) {
                // Priority: 1. Custom avatar from profiles table, 2. Google avatar, 3. Default
                const avatarUrl = customAvatarUrl || user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=6b9ece&color=fff`;
                const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=6b9ece&color=fff`;

                // Create image with proper error handling
                const img = document.createElement('img');
                img.alt = 'Avatar';
                img.onerror = function () {
                    console.warn('⚠️ Avatar load failed, using fallback');
                    this.onerror = null;
                    this.src = fallbackUrl;
                };
                img.src = avatarUrl;

                // Clear and append
                avatarBtn.innerHTML = '';
                avatarBtn.appendChild(img);

                // 🆕 Update localStorage cache with correct avatar to prevent flash on next load
                const cachedProfile = {
                    avatarUrl: avatarUrl,
                    nickname: displayName,
                    username: user.email
                };
                localStorage.setItem('cached_user_profile', JSON.stringify(cachedProfile));
                console.log('💾 Updated cached_user_profile with correct avatar');
            }

            // Hide login button, show other buttons for logged-in users
            setPromptsDisplayState(loginBtn, false, 'prompts-display-flex');
            setPromptsDisplayState(profileBtn, true, 'prompts-display-flex');
            setPromptsDisplayState(walletBtn, true, 'prompts-display-flex');
            setPromptsDisplayState(switchAccountBtn, true, 'prompts-display-flex');
            setPromptsDisplayState(logoutBtn, true, 'prompts-display-flex');

            // Only show Enter Studio for admin
            setPromptsDisplayState(adminStudioBtn, isAdmin, 'prompts-display-flex');
        } else {
            // Guest - show login button, hide all user controls
            if (identityName) identityName.textContent = 'Guest';
            setPromptsDisplayState(loginBtn, true, 'prompts-display-flex');
            setPromptsDisplayState(profileBtn, false, 'prompts-display-flex');
            setPromptsDisplayState(walletBtn, false, 'prompts-display-flex');
            setPromptsDisplayState(switchAccountBtn, false, 'prompts-display-flex');
            setPromptsDisplayState(logoutBtn, false, 'prompts-display-flex');
            setPromptsDisplayState(adminStudioBtn, false, 'prompts-display-flex');
            window.ZaoyoeAdminPresence?.stop?.();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

function showLoginModal() {
    closeAvatarMenu();

    if (typeof window.openLoginModal === 'function') {
        const unifiedModal = document.getElementById('loginModal');
        if (unifiedModal) {
            unifiedModal.classList.add('prompts-auth-modal-promoted');
        }
        window.openLoginModal();
        return;
    }

    console.warn('Unified auth sheet is not ready yet on prompts page.');
}

function closeAdminLoginModal() {
    window.closeLoginModal?.();
}

// Gallery login handler (for user dropdown)
function handleGalleryLogin() {
    console.log('🔐 Gallery login clicked');
    closeAvatarMenu();

    if (typeof window.triggerGoogleLogin === 'function') {
        window.triggerGoogleLogin();
    } else if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                showLoginModal();
            }
        });
    } else {
        showLoginModal(); // Fallback if script not loaded
    }
}

async function logoutUser() {
    if (!window.supabaseClient) {
        alert('Supabase client not available');
        return;
    }

    // 确认提示
    if (!confirm('确定要退出登录吗？')) {
        return;
    }

    try {
        // 显示加载状态
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>正在退出...</span>';
        }

        // 执行登出
        const { error } = await window.supabaseClient.auth.signOut();

        if (error) {
            console.error('Logout error:', error);
            alert('退出登录失败：' + error.message);
            if (logoutBtn) {
                logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i><span>Logout</span>';
            }
            return;
        }

        // 清除本地缓存
        localStorage.removeItem('cached_user_profile');

        // 更新 UI
        checkAuthState();

        // 关闭下拉菜单
        closeAvatarMenu();

        // 刷新页面以完全清除状态
        window.location.reload();

    } catch (err) {
        console.error('Logout exception:', err);
        alert('退出登录时发生错误');
    }
}

function openGalleryProfile() {
    // Navigate to homepage with profile modal flag
    closeAvatarMenu();
    sessionStorage.setItem('openProfileModal', 'true');
    window.location.href = 'index.html';
}

async function switchGalleryAccount() {
    closeAvatarMenu();
    if (!window.supabaseClient) return;

    // Sign out and redirect to homepage login
    await window.supabaseClient.auth.signOut();
    sessionStorage.setItem('openLoginModal', 'true');
    window.location.href = 'index.html';
}

function enterAdminStudio() {
    // Navigate to Admin Studio
    window.location.href = 'admin-studio.html';
    closeAvatarMenu();
}

// Initialize theme before page renders
initTheme();

// ========================================
// SUPABASE DATA LOADING
// ========================================
const PROMPT_GALLERY_SKELETON_COUNT = 8;
const PROMPT_NAV_SKELETON_COUNT = 8;
const PROMPT_GALLERY_EAGER_IMAGE_COUNT = 4;
const promptGalleryImageWarmCache = new Set();

function getPromptAdminVisibilityStatus(prompt = {}) {
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

function hasPromptPageVisibleCopy(value) {
    return String(value || '').trim().length > 0;
}

function isPromptVisibleOnPromptsPage(prompt = {}) {
    const status = getPromptAdminVisibilityStatus(prompt);
    if (status === 'draft' || status === 'archived') {
        return false;
    }

    const hasBaseTitle = hasPromptPageVisibleCopy(prompt?.title);
    const hasPromptText = hasPromptPageVisibleCopy(prompt?.prompt_text || prompt?.prompt);
    const hasDeferredPromptText = prompt?.hasPromptDetail === true || prompt?.promptSummaryOnly === true;
    const hasImages = getPromptImageAssets(prompt).some((item) => hasPromptPageVisibleCopy(getPromptImageAssetOriginalUrl(item)));

    return hasBaseTitle && (hasPromptText || hasDeferredPromptText) && hasImages;
}

function filterVisiblePromptsForPromptsPage(prompts = []) {
    return (Array.isArray(prompts) ? prompts : []).filter((prompt) => isPromptVisibleOnPromptsPage(prompt));
}

async function waitForPromptSupabaseClientReady(timeoutMs = 2200) {
    if (window.supabaseClient) {
        return true;
    }

    const currentState = window.__ZAOYOE_SUPABASE_CLIENT_STATE__ || null;
    if (currentState?.status === 'error') {
        return false;
    }

    return new Promise((resolve) => {
        let settled = false;
        let timer = null;

        const cleanup = () => {
            if (timer) {
                window.clearTimeout(timer);
            }
            window.removeEventListener('zaoyoe:supabase-client-state', handleStateChange);
        };

        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(value);
        };

        const handleStateChange = (event) => {
            const status = String(event?.detail?.status || '').trim().toLowerCase();
            if (status === 'ready' && window.supabaseClient) {
                finish(true);
                return;
            }

            if (status === 'error') {
                finish(false);
            }
        };

        window.addEventListener('zaoyoe:supabase-client-state', handleStateChange);
        timer = window.setTimeout(() => finish(Boolean(window.supabaseClient)), timeoutMs);
    });
}

const STATIC_PROMPTS_SUMMARY_SRC = 'js/prompts-summary-data.js?v=20260501_PROMPTS_SUMMARY_DATA_1';
const STATIC_PROMPTS_DETAIL_SRC = 'prompts-data.js?v=20260302_G_AUTH';
const PROMPTS_SUPABASE_SUMMARY_SELECT = [
    'id',
    'title',
    'title_en',
    'title_zh',
    'tags',
    'description',
    'description_en',
    'description_zh',
    'images',
    'image_assets',
    'dominant_colors',
    'ai_tags',
    'created_at'
].join(',');
const PROMPTS_SUPABASE_SUMMARY_LEGACY_SELECT = PROMPTS_SUPABASE_SUMMARY_SELECT
    .split(',')
    .filter((field) => field !== 'image_assets')
    .join(',');
const PROMPTS_SUPABASE_DETAIL_SELECT = [
    'id',
    'title',
    'title_en',
    'title_zh',
    'tags',
    'description',
    'description_en',
    'description_zh',
    'prompt_text',
    'prompt_text_en',
    'prompt_text_zh',
    'images',
    'image_assets',
    'dominant_colors',
    'ai_tags'
].join(',');
const PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT = [
    'id',
    'title',
    'title_en',
    'title_zh',
    'tags',
    'description',
    'description_en',
    'description_zh',
    'prompt_text',
    'prompt_text_en',
    'prompt_text_zh',
    'dominant_colors',
    'ai_tags'
].join(',');
const PROMPTS_SUPABASE_DETAIL_LEGACY_SELECT = PROMPTS_SUPABASE_DETAIL_SELECT
    .split(',')
    .filter((field) => field !== 'image_assets')
    .join(',');
let staticPromptsFallbackPromise = null;
let staticPromptDetailPromise = null;
let promptSearchDetailHydrationPromise = null;
let promptSearchDetailsHydrated = false;
const promptDetailLoadPromises = new Map();

function isMissingPromptImageAssetsColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return Boolean(message && (
        message.includes('image_assets')
        || message.includes('column of "prompts"')
        || message.includes("column of 'prompts'")
    ));
}

function replacePromptDataset(nextPrompts = []) {
    const visiblePrompts = filterVisiblePromptsForPromptsPage(nextPrompts).map((prompt, index) => ({
        ...prompt,
        id: index,
        supabaseId: prompt?.supabaseId || prompt?.id || null
    }));

    while (PROMPTS.length > 0) {
        PROMPTS.pop();
    }

    visiblePrompts.forEach((prompt) => PROMPTS.push(prompt));
    window.PROMPTS = PROMPTS;
    promptSearchDetailsHydrated = false;
    promptSearchDetailHydrationPromise = null;
    invalidatePromptSearchCaches();
    return visiblePrompts;
}

function normalizeSupabasePromptSummary(item = {}, index = 0) {
    const imageAssets = normalizePromptImageAssetsFromRecord(item);
    return {
        id: index,
        supabaseId: item.id,
        title: item.title || '',
        title_en: item.title_en || '',
        title_zh: item.title_zh || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        description: item.description || '',
        description_en: item.description_en || '',
        description_zh: item.description_zh || '',
        images: imageAssets.map(getPromptImageAssetOriginalUrl).filter(Boolean),
        imageAssets,
        image_assets: imageAssets,
        dominantColors: Array.isArray(item.dominant_colors) ? item.dominant_colors : [],
        aiTags: item.ai_tags || {},
        createdAt: item.created_at || '',
        hasPromptDetail: true,
        promptSummaryOnly: true,
        detailSource: 'supabase'
    };
}

function normalizeSupabasePromptDetail(item = {}) {
    const imageAssets = normalizePromptImageAssetsFromRecord(item);
    return {
        supabaseId: item.id,
        title: item.title || '',
        title_en: item.title_en || '',
        title_zh: item.title_zh || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        description: item.description || '',
        description_en: item.description_en || '',
        description_zh: item.description_zh || '',
        prompt: item.prompt_text || '',
        prompt_text: item.prompt_text || '',
        prompt_text_en: item.prompt_text_en || '',
        prompt_text_zh: item.prompt_text_zh || '',
        images: imageAssets.map(getPromptImageAssetOriginalUrl).filter(Boolean),
        imageAssets,
        image_assets: imageAssets,
        dominantColors: Array.isArray(item.dominant_colors) ? item.dominant_colors : [],
        aiTags: item.ai_tags || {},
        hasPromptDetail: true,
        promptSummaryOnly: false,
        promptDetailLoaded: true,
        detailSource: 'supabase'
    };
}

function normalizeSupabasePromptSearchDetail(item = {}) {
    return {
        supabaseId: item.id,
        title: item.title || '',
        title_en: item.title_en || '',
        title_zh: item.title_zh || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        description: item.description || '',
        description_en: item.description_en || '',
        description_zh: item.description_zh || '',
        prompt: item.prompt_text || '',
        prompt_text: item.prompt_text || '',
        prompt_text_en: item.prompt_text_en || '',
        prompt_text_zh: item.prompt_text_zh || '',
        dominantColors: Array.isArray(item.dominant_colors) ? item.dominant_colors : [],
        aiTags: item.ai_tags || {},
        hasPromptDetail: true,
        promptSummaryOnly: false,
        promptDetailLoaded: true,
        detailSource: 'supabase'
    };
}

function getPromptStaticSummaryDataset() {
    if (Array.isArray(window.__PROMPTS_SUMMARY__) && window.__PROMPTS_SUMMARY__.length > 0) {
        return window.__PROMPTS_SUMMARY__;
    }
    if (Array.isArray(window.__STATIC_PROMPTS__) && window.__STATIC_PROMPTS__.length > 0) {
        return window.__STATIC_PROMPTS__;
    }
    return [];
}

async function loadStaticPromptFallbackData() {
    const existingDataset = getPromptStaticSummaryDataset();
    if (existingDataset.length > 0) {
        return replacePromptDataset(existingDataset);
    }

    if (staticPromptsFallbackPromise) {
        return staticPromptsFallbackPromise;
    }

    staticPromptsFallbackPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-prompt-static-summary="1"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => {
                resolve(replacePromptDataset(getPromptStaticSummaryDataset()));
            }, { once: true });
            existingScript.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = STATIC_PROMPTS_SUMMARY_SRC;
        script.async = true;
        script.dataset.promptStaticSummary = '1';
        script.addEventListener('load', () => {
            resolve(replacePromptDataset(getPromptStaticSummaryDataset()));
        }, { once: true });
        script.addEventListener('error', () => {
            reject(new Error('Failed to load static prompts summary fallback'));
        }, { once: true });
        document.head.appendChild(script);
    }).catch((error) => {
        staticPromptsFallbackPromise = null;
        console.warn('Static prompts summary unavailable, falling back to detail data:', error?.message || error);
        return loadStaticPromptDetailData().then((detailPrompts) => replacePromptDataset(detailPrompts));
    });

    return staticPromptsFallbackPromise;
}

function getPromptDetailLookupKeys(item = {}) {
    return [
        item?.supabaseId,
        item?.sourceId,
        item?.staticId,
        item?.originalId,
        item?.id
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
}

function getPromptTitleLookupKeys(item = {}) {
    return [
        item?.title,
        item?.title_en,
        item?.title_zh
    ]
        .map(normalizePromptSearchText)
        .filter(Boolean);
}

function hasPromptDetailBody(item = {}) {
    return [
        item?.prompt,
        item?.prompt_text,
        item?.prompt_text_en,
        item?.prompt_text_zh
    ].some((value) => hasPromptPageVisibleCopy(value));
}

function mergePromptDetailIntoItem(item = {}, detail = {}) {
    if (!item || !detail) return item;

    Object.assign(item, {
        title: detail.title || item.title || '',
        title_en: detail.title_en || item.title_en || '',
        title_zh: detail.title_zh || item.title_zh || '',
        tags: Array.isArray(detail.tags) ? detail.tags : (item.tags || []),
        description: detail.description || item.description || '',
        description_en: detail.description_en || item.description_en || '',
        description_zh: detail.description_zh || item.description_zh || '',
        prompt: detail.prompt || detail.prompt_text || item.prompt || '',
        prompt_text: detail.prompt_text || detail.prompt || item.prompt_text || '',
        prompt_text_en: detail.prompt_text_en || item.prompt_text_en || '',
        prompt_text_zh: detail.prompt_text_zh || item.prompt_text_zh || '',
        imageAssets: getPromptImageAssets(detail).length > 0 ? getPromptImageAssets(detail) : getPromptImageAssets(item),
        image_assets: getPromptImageAssets(detail).length > 0 ? getPromptImageAssets(detail) : getPromptImageAssets(item),
        images: (getPromptImageAssets(detail).length > 0 ? getPromptImageAssets(detail) : getPromptImageAssets(item))
            .map(getPromptImageAssetOriginalUrl)
            .filter(Boolean),
        dominantColors: Array.isArray(detail.dominantColors) ? detail.dominantColors : (item.dominantColors || []),
        aiTags: detail.aiTags || item.aiTags || {},
        hasPromptDetail: true,
        promptSummaryOnly: false,
        promptDetailLoaded: hasPromptDetailBody(detail) || hasPromptDetailBody(item)
    });

    return item;
}

async function loadStaticPromptDetailData() {
    if (Array.isArray(window.__STATIC_PROMPTS__) && window.__STATIC_PROMPTS__.length > 0) {
        return window.__STATIC_PROMPTS__;
    }

    if (staticPromptDetailPromise) {
        return staticPromptDetailPromise;
    }

    staticPromptDetailPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-prompt-static-detail="1"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => {
                resolve(window.__STATIC_PROMPTS__ || []);
            }, { once: true });
            existingScript.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = STATIC_PROMPTS_DETAIL_SRC;
        script.async = true;
        script.dataset.promptStaticDetail = '1';
        script.addEventListener('load', () => {
            resolve(window.__STATIC_PROMPTS__ || []);
        }, { once: true });
        script.addEventListener('error', () => {
            reject(new Error('Failed to load static prompts detail data'));
        }, { once: true });
        document.head.appendChild(script);
    }).catch((error) => {
        staticPromptDetailPromise = null;
        throw error;
    });

    return staticPromptDetailPromise;
}

function findStaticPromptDetailForItem(item = {}, staticPrompts = []) {
    const lookupKeys = new Set(getPromptDetailLookupKeys(item));
    const titleKeys = new Set(getPromptTitleLookupKeys(item));
    if (!lookupKeys.size && !titleKeys.size) return null;

    return (Array.isArray(staticPrompts) ? staticPrompts : []).find((prompt) => {
        return getPromptDetailLookupKeys(prompt).some((key) => lookupKeys.has(key))
            || getPromptTitleLookupKeys(prompt).some((key) => titleKeys.has(key));
    }) || null;
}

async function fetchSupabasePromptDetail(item = {}) {
    if (!window.supabaseClient || item?.detailSource !== 'supabase') return null;

    const promptId = String(item.supabaseId || '').trim();
    if (!promptId) return null;

    let { data, error } = await window.supabaseClient
        .from('prompts')
        .select(PROMPTS_SUPABASE_DETAIL_SELECT)
        .eq('id', promptId)
        .maybeSingle();

    if (error && isMissingPromptImageAssetsColumnError(error)) {
        const fallbackResult = await window.supabaseClient
            .from('prompts')
            .select(PROMPTS_SUPABASE_DETAIL_LEGACY_SELECT)
            .eq('id', promptId)
            .maybeSingle();
        data = fallbackResult.data;
        error = fallbackResult.error;
    }

    if (error) {
        throw error;
    }

    return data ? normalizeSupabasePromptDetail(data) : null;
}

async function fetchSupabasePromptSearchDetails() {
    if (!window.supabaseClient) return 0;

    const targetPrompts = PROMPTS.filter((item) => {
        return item?.detailSource === 'supabase'
            && !hasPromptDetailBody(item)
            && String(item.supabaseId || '').trim();
    });
    if (!targetPrompts.length) return 0;

    const ids = Array.from(new Set(targetPrompts.map((item) => String(item.supabaseId || '').trim()).filter(Boolean)));
    if (!ids.length) return 0;

    const { data, error } = await window.supabaseClient
        .from('prompts')
        .select(PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT)
        .in('id', ids);

    if (error) {
        throw error;
    }

    const detailsById = new Map(
        (Array.isArray(data) ? data : [])
            .map((item) => normalizeSupabasePromptSearchDetail(item))
            .map((detail) => [String(detail.supabaseId || '').trim(), detail])
            .filter(([id]) => id)
    );

    let changedCount = 0;
    targetPrompts.forEach((item) => {
        const detail = detailsById.get(String(item.supabaseId || '').trim());
        if (!detail) return;
        mergePromptDetailIntoItem(item, detail);
        changedCount += 1;
    });

    return changedCount;
}

async function hydratePromptSearchDetails() {
    if (promptSearchDetailsHydrated) return false;
    if (promptSearchDetailHydrationPromise) return promptSearchDetailHydrationPromise;

    promptSearchDetailHydrationPromise = (async () => {
        let changed = false;

        try {
            const supabaseChangedCount = await fetchSupabasePromptSearchDetails();
            changed = changed || supabaseChangedCount > 0;
        } catch (error) {
            console.warn('Failed to hydrate Supabase prompt text for search:', error?.message || error);
        }

        if (PROMPTS.some((item) => item && !hasPromptDetailBody(item))) {
            try {
                const staticPrompts = await loadStaticPromptDetailData();
                PROMPTS.forEach((item) => {
                    if (!item || hasPromptDetailBody(item)) return;
                    const detail = findStaticPromptDetailForItem(item, staticPrompts);
                    if (!detail) return;
                    mergePromptDetailIntoItem(item, detail);
                    changed = true;
                });
            } catch (error) {
                console.warn('Failed to hydrate static prompt text for search:', error?.message || error);
            }
        }

        promptSearchDetailsHydrated = true;
        if (changed) {
            invalidatePromptSearchCaches();
        }
        return changed;
    })().finally(() => {
        promptSearchDetailHydrationPromise = null;
    });

    return promptSearchDetailHydrationPromise;
}

async function ensurePromptDetailLoaded(item = {}) {
    if (!item || hasPromptDetailBody(item)) {
        return item;
    }

    const cacheKey = getPromptDetailLookupKeys(item)[0] || String(item.id || '');
    if (promptDetailLoadPromises.has(cacheKey)) {
        return promptDetailLoadPromises.get(cacheKey);
    }

    const loadPromise = (async () => {
        let detail = await fetchSupabasePromptDetail(item);

        if (!detail) {
            const staticPrompts = await loadStaticPromptDetailData();
            detail = findStaticPromptDetailForItem(item, staticPrompts);
        }

        if (detail) {
            return mergePromptDetailIntoItem(item, detail);
        }

        return item;
    })().catch((error) => {
        promptDetailLoadPromises.delete(cacheKey);
        throw error;
    });

    promptDetailLoadPromises.set(cacheKey, loadPromise);
    return loadPromise;
}

async function loadPromptsFromSupabase() {
    if (!window.supabaseClient) {
        const runtimeReady = await waitForPromptSupabaseClientReady();
        if (!runtimeReady || !window.supabaseClient) {
            console.log('Supabase client not available, loading static fallback data');
            await loadStaticPromptFallbackData().catch((fallbackError) => {
                console.warn('Failed to load static prompts fallback:', fallbackError?.message || fallbackError);
            });
            return false;
        }
    }

    if (!window.supabaseClient) {
        console.log('Supabase client not available, loading static fallback data');
        await loadStaticPromptFallbackData().catch((fallbackError) => {
            console.warn('Failed to load static prompts fallback:', fallbackError?.message || fallbackError);
        });
        return false;
    }

    try {
        let { data, error } = await window.supabaseClient
            .from('prompts')
            .select(PROMPTS_SUPABASE_SUMMARY_SELECT)
            .not('prompt_text', 'is', null)
            .neq('prompt_text', '')
            .order('created_at', { ascending: false });

        if (error && isMissingPromptImageAssetsColumnError(error)) {
            const fallbackResult = await window.supabaseClient
                .from('prompts')
                .select(PROMPTS_SUPABASE_SUMMARY_LEGACY_SELECT)
                .not('prompt_text', 'is', null)
                .neq('prompt_text', '')
                .order('created_at', { ascending: false });
            data = fallbackResult.data;
            error = fallbackResult.error;
        }

        if (error) {
            console.error('Supabase fetch error:', error);
            await loadStaticPromptFallbackData().catch((fallbackError) => {
                console.warn('Failed to load static prompts fallback:', fallbackError?.message || fallbackError);
            });
            return false;
        }

        if (data && data.length > 0) {
            // Transform Supabase data to match PROMPTS format
            const supabasePrompts = data.map((item, index) => normalizeSupabasePromptSummary(item, index));
            const visibleSupabasePrompts = filterVisiblePromptsForPromptsPage(supabasePrompts);
            const normalizedSupabasePrompts = replacePromptDataset(visibleSupabasePrompts);

            console.log(`Loaded ${normalizedSupabasePrompts.length} visible prompts from Supabase (filtered ${Math.max(0, supabasePrompts.length - visibleSupabasePrompts.length)} hidden prompts)`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('Error loading from Supabase:', err);
        await loadStaticPromptFallbackData().catch((fallbackError) => {
            console.warn('Failed to load static prompts fallback:', fallbackError?.message || fallbackError);
        });
        return false;
    }
}

function buildPromptCardSkeletonMarkup(index = 0) {
    const titleWidthClasses = [
        'prompt-card-skeleton-title--wide',
        'prompt-card-skeleton-title--medium',
        'prompt-card-skeleton-title--short'
    ];
    const metaWidthClasses = [
        'prompt-card-skeleton-meta--medium',
        'prompt-card-skeleton-meta--short',
        'prompt-card-skeleton-meta--wide'
    ];
    const titleWidthClass = titleWidthClasses[index % titleWidthClasses.length];
    const metaWidthClass = metaWidthClasses[index % metaWidthClasses.length];

    return `
        <div class="prompt-card-media-skeleton" aria-hidden="true">
            <div class="skeleton prompts-skeleton-block prompt-card-skeleton-image"></div>
            <div class="prompt-card-skeleton-overlay">
                <span class="skeleton prompts-skeleton-block prompt-card-skeleton-title ${titleWidthClass}"></span>
                <span class="skeleton prompts-skeleton-block prompt-card-skeleton-meta ${metaWidthClass}"></span>
            </div>
        </div>
    `;
}

function buildPromptNavSkeletonMarkup(count = PROMPT_NAV_SKELETON_COUNT) {
    const titleWidthClasses = [
        'nav-item-skeleton--title-wide',
        'nav-item-skeleton--title-medium',
        'nav-item-skeleton--title-short',
        'nav-item-skeleton--title-medium'
    ];
    const subtitleWidthClasses = [
        'nav-item-skeleton--subtitle-wide',
        'nav-item-skeleton--subtitle-medium',
        'nav-item-skeleton--subtitle-short',
        'nav-item-skeleton--subtitle-medium'
    ];
    const safeCount = Math.min(Math.max(Number.parseInt(count, 10) || PROMPT_NAV_SKELETON_COUNT, 6), 10);

    return Array.from({ length: safeCount }, (_, index) => `
        <div class="nav-item nav-item--skeleton" aria-hidden="true" data-nav-skeleton-index="${index}">
            <span class="skeleton nav-item-skeleton nav-item-skeleton--title ${titleWidthClasses[index % titleWidthClasses.length]}"></span>
            <span class="skeleton nav-item-skeleton nav-item-skeleton--subtitle ${subtitleWidthClasses[index % subtitleWidthClasses.length]}"></span>
        </div>
    `).join('');
}

function renderPromptNavSkeletons(count = PROMPT_NAV_SKELETON_COUNT) {
    const navContainer = document.getElementById('navItems');
    if (!navContainer) return;

    navContainer.classList.remove('loaded', 'nav-items--hydrated');
    navContainer.classList.add('nav-items--skeleton');
    navContainer.innerHTML = buildPromptNavSkeletonMarkup(count);
}

function renderFeaturedBannerSkeleton() {
    const banner = document.getElementById('featuredBanner');
    const image = document.getElementById('featuredImage');
    if (!banner) return;

    banner.classList.add('featured-banner--visible', 'featured-banner--loading');
    banner.classList.remove('featured-banner--revealed', 'featured-banner--interactive');
    banner.onclick = null;

    if (image) {
        image.removeAttribute('src');
    }
}

function warmPromptGalleryLeadImages(items = []) {
    const leadItems = (Array.isArray(items) ? items : []).slice(0, PROMPT_GALLERY_EAGER_IMAGE_COUNT);

    leadItems.forEach((item) => {
        const optimizedUrl = getOptimizedImageUrl(getPromptPrimaryImageAsset(item), { variant: 'card' });
        if (!optimizedUrl || promptGalleryImageWarmCache.has(optimizedUrl)) return;

        promptGalleryImageWarmCache.add(optimizedUrl);
        const warmImage = new Image();
        warmImage.decoding = 'async';
        if ('fetchPriority' in warmImage) {
            warmImage.fetchPriority = 'high';
        }
        warmImage.src = optimizedUrl;
    });
}

function renderPromptGallerySkeletons(count = PROMPT_GALLERY_SKELETON_COUNT) {
    const grid = document.querySelector('.gallery-container');
    if (!grid) return;

    const safeCount = Math.min(Math.max(Number.parseInt(count, 10) || PROMPT_GALLERY_SKELETON_COUNT, 4), 12);
    grid.classList.add('visible');
    grid.innerHTML = Array.from({ length: safeCount }, (_, index) => `
        <div class="prompt-card prompt-card--skeleton" aria-hidden="true" data-skeleton-index="${index}">
            ${buildPromptCardSkeletonMarkup(index)}
        </div>
    `).join('');
}

function markPromptCardImageReady(card, cardImage) {
    if (!card) return;
    card.classList.remove('prompt-card--loading');
    card.classList.add('prompt-card--loaded');
    cardImage?.classList.add('loaded');
}

function setPromptCardImageSource(cardImage, imageAsset) {
    if (!cardImage || !imageAsset) return;

    const rawOriginalUrl = getPromptImageAssetOriginalUrl(imageAsset);
    if (isSupabaseStorageImageUrl(rawOriginalUrl)) {
        cardImage.dataset.originalSrc = '';
        cardImage.dataset.transformFallbackSrc = '';
        cardImage.dataset.fallbackStage = '';
        cardImage.removeAttribute('src');
        return;
    }

    const originalUrl = normalizePromptCdnUrlForCurrentSite(rawOriginalUrl) || rawOriginalUrl;
    const primaryUrl = getOptimizedImageUrl(imageAsset, { variant: 'card' });
    const transformFallbackUrl = getOptimizedImageUrl(imageAsset, { format: '' });

    cardImage.dataset.originalSrc = originalUrl;
    cardImage.dataset.transformFallbackSrc = transformFallbackUrl !== primaryUrl ? transformFallbackUrl : '';
    cardImage.dataset.fallbackStage = '';
    if (primaryUrl) {
        cardImage.src = primaryUrl;
    } else {
        cardImage.removeAttribute('src');
    }
}

function getUniquePromptImageCandidates(urls = []) {
    const seen = new Set();
    return urls
        .map((url) => String(url || '').trim())
        .filter((url) => {
            if (!url || seen.has(url) || isSupabaseStorageImageUrl(url)) return false;
            seen.add(url);
            return true;
        });
}

function getFeaturedBannerImageCandidates(imageAsset) {
    const trimmed = getPromptImageAssetOriginalUrl(imageAsset);
    if (!trimmed) return [];

    return getUniquePromptImageCandidates([
        getOptimizedImageUrl(imageAsset, { variant: 'featured' }),
        getOptimizedImageUrl(imageAsset, { variant: 'thumb' }),
        getOptimizedImageUrl(imageAsset, { variant: 'card' }),
        getOptimizedImageUrl(imageAsset, { variant: 'home' }),
        trimmed
    ]);
}

function setFeaturedBannerImageSource(image, imageAsset) {
    if (!image || !imageAsset) return Promise.resolve(false);

    const originalUrl = getPromptImageAssetOriginalUrl(imageAsset);
    const candidates = getFeaturedBannerImageCandidates(imageAsset);
    if (!candidates.length) return Promise.resolve(false);

    image.classList.remove('featured-image--loaded', 'featured-image--failed');
    image.dataset.featuredOriginalSrc = String(originalUrl || '').trim();
    image.dataset.featuredFallbackIndex = '0';

    return new Promise((resolve) => {
        let settled = false;
        const finish = (loaded) => {
            if (settled) return;
            settled = true;
            if (loaded) {
                image.classList.add('featured-image--loaded');
                image.classList.remove('featured-image--failed');
            } else {
                image.classList.add('featured-image--failed');
            }
            resolve(Boolean(loaded));
        };

        image.onload = () => finish(true);
        image.onerror = () => {
            const nextIndex = (Number.parseInt(image.dataset.featuredFallbackIndex || '0', 10) || 0) + 1;
            const nextSrc = candidates[nextIndex];
            if (nextSrc) {
                image.dataset.featuredFallbackIndex = String(nextIndex);
                image.src = nextSrc;
                return;
            }

            finish(false);
        };

        image.src = candidates[0];
        if (image.complete && image.naturalWidth > 0) {
            finish(true);
        }
    });
}

function waitForPromptFeaturedFirstImage(imagePromise) {
    return Promise.race([
        Promise.resolve(imagePromise).catch(() => false),
        new Promise((resolve) => {
            window.setTimeout(() => resolve(false), PROMPT_FEATURED_FIRST_IMAGE_TIMEOUT_MS);
        })
    ]);
}

function renderFeaturedBannerConfiguredUpdate(immediateFeatured) {
    return (async () => {
        const homepageConfig = await loadHomepagePromptsConfigForBanner();
        const configuredFeatured = resolveHomepageFeaturedBannerPrompt(homepageConfig);
        if (configuredFeatured) {
            applyFeaturedBannerPrompt(configuredFeatured);
            return;
        }

        applyFeaturedBannerPrompt(immediateFeatured);
    })();
}

const PROMPTS_DEFERRED_TASK_TIMEOUT_MS = 1600;
const PROMPTS_DEFERRED_VISUAL_DELAY_MS = 900;
const PROMPTS_DEFERRED_COMMENT_COUNT_DELAY_MS = 4200;
const PROMPTS_DEFERRED_SEARCH_INDEX_DELAY_MS = 5200;
const PROMPT_FEATURED_FIRST_IMAGE_TIMEOUT_MS = 240;
const PROMPT_GALLERY_CONFIG_FIRST_RENDER_TIMEOUT_MS = 320;
let promptsDeferredEnhancementsScheduled = false;
const promptsDeferredTasksScheduled = new Set();
const promptsDeferredTasksExecuted = new Set();
let promptStarrySkyRuntimePromise = null;

function runPromptDeferredTask(taskName, task) {
    try {
        return Promise.resolve(task()).catch((error) => {
            console.warn(`[PromptsDeferred] ${taskName} failed:`, error?.message || error);
        });
    } catch (error) {
        console.warn(`[PromptsDeferred] ${taskName} failed:`, error?.message || error);
        return Promise.resolve();
    }
}

function runPromptDeferredTaskOnce(taskName, task) {
    if (promptsDeferredTasksExecuted.has(taskName)) {
        return Promise.resolve();
    }
    promptsDeferredTasksExecuted.add(taskName);
    return runPromptDeferredTask(taskName, task);
}

function schedulePromptIdleTask(taskName, task, options = {}) {
    if (promptsDeferredTasksScheduled.has(taskName) || promptsDeferredTasksExecuted.has(taskName)) {
        return;
    }

    promptsDeferredTasksScheduled.add(taskName);
    const delayMs = Math.max(0, Number(options.delayMs || 0));
    const timeoutMs = Math.max(1, Number(options.timeoutMs || PROMPTS_DEFERRED_TASK_TIMEOUT_MS));

    const requestRun = () => {
        const run = () => {
            void runPromptDeferredTaskOnce(taskName, task);
        };

        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout: timeoutMs });
        } else {
            window.setTimeout(run, Math.min(timeoutMs, 900));
        }
    };

    if (delayMs > 0) {
        window.setTimeout(requestRun, delayMs);
    } else {
        requestRun();
    }
}

function warmPromptSearchIndex() {
    return runPromptDeferredTaskOnce('search-index', () => {
        if (!SEARCH_INDEX) {
            buildSearchIndex();
        }
    });
}

function schedulePromptSearchIndexWarmup() {
    const searchInput = document.getElementById('gallerySearch');
    const warm = () => {
        void warmPromptSearchIndex();
    };

    searchInput?.addEventListener('focus', warm, { once: true, passive: true });
    searchInput?.addEventListener('input', warm, { once: true, passive: true });

    schedulePromptIdleTask('search-index', warmPromptSearchIndex, {
        delayMs: PROMPTS_DEFERRED_SEARCH_INDEX_DELAY_MS,
        timeoutMs: 2400
    });
}

function shouldLoadPromptStarrySkyRuntime(options = {}) {
    if (options.force === true) return true;
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function loadPromptStarrySkyRuntime(options = {}) {
    if (!document.getElementById('starryCanvas') || !shouldLoadPromptStarrySkyRuntime(options)) {
        return Promise.resolve();
    }

    if (promptStarrySkyRuntimePromise) {
        return promptStarrySkyRuntimePromise;
    }

    const existingScript = document.querySelector('script[data-prompt-starry-sky="1"]');
    if (existingScript) {
        return Promise.resolve(existingScript);
    }

    promptStarrySkyRuntimePromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'starry-sky.js?v=20260501_PROMPTS_IDLE_STARRY_1';
        script.async = true;
        script.dataset.promptStarrySky = '1';
        script.addEventListener('load', () => resolve(script), { once: true });
        script.addEventListener('error', () => {
            promptStarrySkyRuntimePromise = null;
            reject(new Error('Failed to load starry sky runtime'));
        }, { once: true });
        document.head.appendChild(script);
    });

    return promptStarrySkyRuntimePromise;
}

function schedulePromptsDeferredEnhancements() {
    if (promptsDeferredEnhancementsScheduled) {
        return;
    }
    promptsDeferredEnhancementsScheduled = true;

    schedulePromptSearchIndexWarmup();
    schedulePromptIdleTask('spotlight', () => initSpotlight(), {
        delayMs: PROMPTS_DEFERRED_VISUAL_DELAY_MS,
        timeoutMs: PROMPTS_DEFERRED_TASK_TIMEOUT_MS
    });
    schedulePromptIdleTask('scroll-reveal', () => setupScrollReveal(), {
        delayMs: PROMPTS_DEFERRED_VISUAL_DELAY_MS,
        timeoutMs: PROMPTS_DEFERRED_TASK_TIMEOUT_MS
    });
    schedulePromptIdleTask('ambient-light', () => initAmbientLight(), {
        delayMs: PROMPTS_DEFERRED_VISUAL_DELAY_MS + 700,
        timeoutMs: 2400
    });
    schedulePromptIdleTask('starry-sky', () => loadPromptStarrySkyRuntime(), {
        delayMs: PROMPTS_DEFERRED_VISUAL_DELAY_MS + 1200,
        timeoutMs: 2400
    });
    schedulePromptIdleTask('comment-count-prefetch', () => preloadPromptCommentCounts(), {
        delayMs: PROMPTS_DEFERRED_COMMENT_COUNT_DELAY_MS,
        timeoutMs: 3000
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initializePromptStaticControls();
    syncPromptNavOffset();
    renderPromptNavSkeletons();
    renderFeaturedBannerSkeleton();
    renderPromptGallerySkeletons();

    // Try to load from Supabase first
    await loadPromptsFromSupabase();

    if (Array.isArray(PROMPTS) && PROMPTS.length > 0) {
        const visiblePrompts = filterVisiblePromptsForPromptsPage(PROMPTS);
        if (visiblePrompts.length !== PROMPTS.length) {
            while (PROMPTS.length > 0) {
                PROMPTS.pop();
            }
            visiblePrompts.forEach((prompt) => PROMPTS.push(prompt));
        }
    }

    // Assign IDs to PROMPTS for favorites to work
    PROMPTS.forEach((p, i) => p.id = i);

    generateDynamicNav(); // New: AI-driven navigation
    const featuredFirstPaintPromise = renderFeaturedBanner({ waitForFirstImage: true });
    const galleryConfigPromise = loadGalleryConfigForFirstRender();

    // Read URL parameters to set initial tag filter
    const urlParams = new URLSearchParams(window.location.search);
    const tagParam = urlParams.get('tag');
    const initialFilter = tagParam || 'all';

    if (tagParam) {
        console.log(`🏷️ URL tag parameter found: ${tagParam}`);
        // Pre-select the corresponding nav item if it exists
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            const filterType = item.getAttribute('data-filter');
            if (filterType && filterType.toLowerCase() === tagParam.toLowerCase()) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    await featuredFirstPaintPromise;
    await galleryConfigPromise;
    renderGallery(initialFilter);
    setupFilters();
    setupInfiniteScroll();
    setupSearch(); // Pinterest-style search
    checkAuthState(); // New: Check if admin is logged in
    schedulePromptsDeferredEnhancements();

    // Fade in nav after fonts load (or timeout)
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            document.querySelector('.nav-items')?.classList.add('loaded');
        });
    } else {
        // Fallback for older browsers
        setTimeout(() => {
            document.querySelector('.nav-items')?.classList.add('loaded');
        }, 100);
    }

    // Check for URL parameter to open specific prompt
    handleUrlPromptParam();
});

window.addEventListener('languageChanged', () => {
    if (!Array.isArray(PROMPTS) || PROMPTS.length === 0) {
        return;
    }

    void renderFeaturedBanner();
    renderGallery(currentFilter, false);
});

// Handle hash changes when page is already loaded (e.g., from admin "View Context" button)
window.addEventListener('hashchange', () => {
    console.log('🔗 Hash changed:', window.location.hash);
    handleUrlPromptParam();
});

// Handle page show event (for back/forward navigation with bfcache)
window.addEventListener('pageshow', (event) => {
    if (event.persisted && window.location.hash) {
        console.log('🔗 Page restored from bfcache with hash:', window.location.hash);
        handleUrlPromptParam();
    }
});

/**
 * Handle URL parameter to open specific prompt modal
 * Usage: prompts.html?id=15 or prompts.html?id=15&comments=1&commentId=123
 * Also supports hash: prompts.html#prompt-15
 */
let pendingPromptId = null; // 保存待处理的 prompt ID，防止 hash 被清空后丢失

function handleUrlPromptParam() {
    const urlParams = new URLSearchParams(window.location.search);
    let promptIdParam = urlParams.get('id');
    const showComments = urlParams.get('comments');
    const commentIdParam = urlParams.get('commentId');

    // 支持 hash 格式: #prompt-xxx
    if (!promptIdParam && window.location.hash) {
        const hash = window.location.hash;
        const hashMatch = hash.match(/^#prompt-(.+)$/);
        if (hashMatch) {
            promptIdParam = hashMatch[1];
            console.log('🔗 从 hash 中找到 prompt ID:', promptIdParam);
        }
    }

    // 如果有之前保存的待处理 ID，优先使用它
    if (!promptIdParam && pendingPromptId) {
        promptIdParam = pendingPromptId;
        console.log('🔗 使用之前保存的 prompt ID:', promptIdParam);
    }

    console.log('🔍 URL 参数检查 - id:', promptIdParam, 'comments:', showComments, 'commentId:', commentIdParam);

    if (!promptIdParam) {
        console.log('URL 中没有 prompt id');
        return;
    }

    // 保存 ID 以防 hash 被清空
    pendingPromptId = promptIdParam;

    // 检查 PROMPTS 是否已加载
    if (typeof PROMPTS === 'undefined' || PROMPTS.length === 0) {
        console.log('⏳ PROMPTS 数据尚未加载，等待重试...');
        setTimeout(() => handleUrlPromptParam(), 500);
        return;
    }

    // 查找对应的 prompt
    const targetIdNum = parseInt(promptIdParam, 10);
    const targetIdStr = String(promptIdParam);

    console.log('🔍 搜索 prompt，id:', targetIdStr, '(解析后数字:', targetIdNum, ')');
    console.log('🔍 PROMPTS 数量:', PROMPTS.length);

    // 按 supabaseId 查找（先尝试字符串，再尝试数字）
    let prompt = PROMPTS.find(p => String(p.supabaseId) === targetIdStr);

    // 如果字符串匹配失败，尝试数字比较
    if (!prompt && !isNaN(targetIdNum)) {
        prompt = PROMPTS.find(p => p.supabaseId === targetIdNum);
    }

    // 如果还是没找到，尝试按数组索引 id 查找
    if (!prompt) {
        prompt = PROMPTS.find(p => p.id === targetIdNum);
    }

    if (prompt) {
        console.log('✅ 找到 prompt:', prompt.title, '索引:', prompt.id);

        // 清除待处理 ID
        pendingPromptId = null;

        // 稍微延迟以确保 Gallery 渲染完成
        setTimeout(() => {
            openPromptModal(prompt.id);

            // 如果 comments=1，自动打开评论模式
            if (showComments === '1') {
                console.log('💬 准备打开评论模式...');
                setTimeout(() => {
                    console.log('💬 自动打开评论模式，当前 isCommentMode:', isCommentMode);
                    if (!isCommentMode) {
                        console.log('💬 调用 toggleCommentMode()');
                        toggleCommentMode();
                    }

                    // 如果提供了 commentId，展开全部并滚动到该评论
                    if (commentIdParam) {
                        console.log('💬 即将滚动到评论:', commentIdParam);
                        setTimeout(() => {
                            console.log('📍 调用 scrollToComment');
                            scrollToComment(commentIdParam);
                        }, 1000);
                    }
                }, 800);
            }
        }, 300);

        // 成功后清理 URL（移除参数，不触发页面重载）
        if (window.history.replaceState) {
            window.history.replaceState({}, '', window.location.pathname);
        }
    } else {
        console.warn('❌ 未找到对应的 prompt，id:', targetIdStr);
        // 不要立即清除，可能是数据还没完全加载
        // 5秒后才清除待处理 ID
        setTimeout(() => {
            if (pendingPromptId === promptIdParam) {
                pendingPromptId = null;
            }
        }, 5000);
    }
}
/**
 * Scroll to and highlight a specific comment
 */
function scrollToComment(commentId) {
    console.log('📍 Scrolling to comment:', commentId);

    // Wait for comments to load with retry
    waitForCommentAndScroll(commentId, 10); // Max 10 retries (5 seconds total)
}

/**
 * Wait for comment to load then scroll to it
 */
function waitForCommentAndScroll(commentId, retriesLeft) {
    const commentEl = document.querySelector(`[data-comment-id="${commentId}"]`);
    const commentList = document.getElementById('commentList');

    if (commentEl) {
        console.log('📍 Found comment element!');

        // First expand if collapsed
        const isCollapsed = commentList?.getAttribute('data-collapsed') === 'true';
        if (isCollapsed) {
            console.log('📍 Expanding collapsed comments');
            handleCollapseToggle();
            // Wait for expand animation then scroll
            setTimeout(() => {
                scrollCommentIntoView(commentEl, commentList);
                highlightComment(commentEl);
            }, 600);
        } else {
            scrollCommentIntoView(commentEl, commentList);
            highlightComment(commentEl);
        }
    } else if (retriesLeft > 0) {
        console.log('📍 Comment not yet loaded, retrying...', retriesLeft);
        setTimeout(() => waitForCommentAndScroll(commentId, retriesLeft - 1), 500);
    } else {
        console.warn('📍 Comment not found after all retries:', commentId);
    }
}

/**
 * Scroll comment into view using container scroll (avoids layout issues)
 */
function scrollCommentIntoView(commentEl, commentList) {
    if (!commentEl || !commentList) return;

    // Get position relative to comment list container
    const containerRect = commentList.getBoundingClientRect();
    const elementRect = commentEl.getBoundingClientRect();
    const scrollTop = commentList.scrollTop;

    // Calculate desired scroll position (center the element)
    const elementTop = elementRect.top - containerRect.top + scrollTop;
    const targetScroll = elementTop - (containerRect.height / 2) + (elementRect.height / 2);

    // Smooth scroll the container
    commentList.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
    });

    console.log('📍 Scrolled container to:', targetScroll);
}

/**
 * Highlight a comment element
 */
function highlightComment(commentEl) {
    commentEl.classList.add('highlight');
    setTimeout(() => {
        commentEl.classList.add('fade-out');
        setTimeout(() => {
            commentEl.classList.remove('highlight', 'fade-out');
        }, 2000);
    }, 3000);
}

function findPromptForEngagementTarget(promptId) {
    const targetId = String(promptId || '').trim();
    if (!targetId || typeof PROMPTS === 'undefined' || !Array.isArray(PROMPTS)) {
        return null;
    }

    const targetIdNum = Number.parseInt(targetId, 10);
    return PROMPTS.find(p => String(p.supabaseId) === targetId)
        || (!Number.isNaN(targetIdNum) ? PROMPTS.find(p => p.supabaseId === targetIdNum) : null)
        || (!Number.isNaN(targetIdNum) ? PROMPTS.find(p => p.id === targetIdNum) : null)
        || null;
}

function focusPromptCommentFromEngagement(target = {}) {
    const promptId = String(target?.promptId || target?.prompt_id || target?.id || '').trim();
    const commentId = String(target?.commentId || target?.comment_id || '').trim();

    if (!promptId) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        const openAndFocus = (retriesLeft = 12) => {
            if (typeof PROMPTS === 'undefined' || !Array.isArray(PROMPTS) || PROMPTS.length === 0) {
                if (retriesLeft <= 0) {
                    resolve(false);
                    return;
                }
                setTimeout(() => openAndFocus(retriesLeft - 1), 250);
                return;
            }

            const prompt = findPromptForEngagementTarget(promptId);
            if (!prompt) {
                if (retriesLeft <= 0) {
                    resolve(false);
                    return;
                }
                setTimeout(() => openAndFocus(retriesLeft - 1), 250);
                return;
            }

            openPromptModal(prompt.id);
            if (!commentId) {
                setTimeout(() => resolve(true), 320);
                return;
            }

            setTimeout(() => {
                if (!isCommentMode) {
                    toggleCommentMode();
                }
                setTimeout(() => {
                    scrollToComment(commentId);
                    resolve(true);
                }, 900);
            }, 700);
        };

        openAndFocus();
    });
}

window.ZaoyoePromptsFocusCommentFromEngagement = focusPromptCommentFromEngagement;

// ========================================
// DYNAMIC NAVIGATION (AI-Driven Categories)
// ========================================
const TAG_TRANSLATIONS = {
    // Main categories
    'Miniature': '微缩',
    'Photography': '摄影',
    'Illustration': '插画',
    '3D Art': '3D艺术',
    '3D': '3D',
    'Creative': '创意',
    'Animation': '动画',
    'Logo': '标志',
    'Poster': '海报',
    'Character': '角色',
    'Landscape': '风景',
    'Portrait': '人像',
    'Abstract': '抽象',
    'Concept': '概念',
    'Fantasy': '幻想',
    'Sci-Fi': '科幻',
    // Common AI sub-tags (styles, moods, scenes)
    'Peaceful': '宁静',
    'Whimsical': '梦幻',
    'Digital art': '数字艺术',
    'Digital Art': '数字艺术',
    'Forest': '森林',
    'Photo manipulation': '照片合成',
    'Photo Manipulation': '照片合成',
    'Nostalgic': '怀旧',
    'Cinematic': '电影感',
    'Surreal': '超现实',
    'Minimalist': '极简',
    'Vintage': '复古',
    'Dreamy': '梦境',
    'Ethereal': '空灵',
    'Moody': '情绪',
    'Vibrant': '鲜艳',
    'Serene': '静谧',
    'Mystical': '神秘',
    'Urban': '都市',
    'Nature': '自然',
    'Ocean': '海洋',
    'Mountain': '山脉',
    'Night': '夜晚',
    'Sunset': '日落',
    'Winter': '冬日',
    'Autumn': '秋天',
    'Rainy': '雨天',
    'Foggy': '雾气',
    'Cozy': '温馨',
    'Elegant': '优雅',
    'Futuristic': '未来',
    'Retro': '复古',
    'Dramatic': '戏剧性',
    'Soft': '柔和',
    'Dark': '暗黑',
    'Light': '明亮',
    'Colorful': '多彩',
    'Monochrome': '单色',
    'Warm': '暖色',
    'Cool': '冷色',
    'Realistic': '写实',
    'Stylized': '风格化',
    'Painterly': '绘画风',
    'Geometric': '几何',
    'Organic': '有机',
    'Textured': '纹理',
    'Smooth': '光滑',
    'Glow': '发光',
    'Neon': '霓虹',
    'Pastel': '粉彩',
    'Watercolor': '水彩',
    'Oil painting': '油画',
    'Sketch': '素描',
    'Anime': '动漫',
    'Cartoon': '卡通',
    'Hyperrealistic': '超写实',
    'Macro': '微距',
    'Aerial': '航拍',
    'Underwater': '水下',
    'Space': '太空',
    'Desert': '沙漠',
    'Beach': '海滩',
    'City': '城市',
    'Village': '乡村',
    'Temple': '寺庙',
    'Castle': '城堡',
    'Garden': '花园',
    'Street': '街道',
    'Interior': '室内',
    'Architecture': '建筑',
    'Food': '美食',
    'Animal': '动物',
    'Pet': '宠物',
    'Bird': '鸟类',
    'Flower': '花卉',
    'Tree': '树木',
    'Cloud': '云彩',
    'Star': '星空',
    'Moon': '月亮',
    'Sun': '太阳',
    'Rain': '雨',
    'Snow': '雪',
    'Fire': '火焰',
    'Water': '水',
    'Ice': '冰',
    'Stone': '石头',
    'Metal': '金属',
    'Glass': '玻璃',
    'Wood': '木头',
    'Fabric': '织物',
    // Additional common sub-tags
    '3d render': '3D渲染',
    '3D render': '3D渲染',
    '3d Render': '3D渲染',
    'Playful': '俏皮',
    'Imaginative': '富有想象力',
    'Photorealistic': '照片级写实',
    'Miniature art': '微缩艺术',
    'Miniature Art': '微缩艺术',
    'Cute': '可爱',
    'Kawaii': '卡哇伊',
    'Detailed': '精细',
    'Intricate': '复杂精美',
    'Simple': '简约',
    'Bold': '大胆',
    'Subtle': '细腻',
    'Harmonious': '和谐',
    'Chaotic': '混沌',
    'Dynamic': '动感',
    'Static': '静态',
    'Flowing': '流动',
    'Sharp': '锐利',
    'Blurry': '模糊',
    'Bokeh': '背景虚化',
    'HDR': '高动态范围',
    'Long exposure': '长曝光',
    'Double exposure': '双重曝光',
    'Tilt shift': '移轴',
    'Fisheye': '鱼眼',
    'Wide angle': '广角',
    'Portrait mode': '人像模式',
    'Black and white': '黑白',
    'Sepia': '褐色调',
    'High contrast': '高对比度',
    'Low key': '低调',
    'High key': '高调',
    'Golden hour': '黄金时刻',
    'Blue hour': '蓝色时刻',
    'Silhouette': '剪影',
    'Reflection': '倒影',
    'Shadow': '阴影',
    'Highlight': '高光',
    'Gradient': '渐变',
    'Pattern': '图案',
    'Symmetry': '对称',
    'Asymmetry': '不对称',
    'Perspective': '透视',
    'Isometric': '等距',
    'Flat': '扁平',
    'Volume': '立体',
    'Depth': '景深',
    'Layered': '分层',
    'Collage': '拼贴',
    'Mixed media': '混合媒介',
    'Digital painting': '数字绘画',
    'Concept art': '概念艺术',
    'Matte painting': '接景画',
    'Environment': '环境',
    'Scenery': '风光',
    'Still life': '静物',
    'Portrait photography': '人像摄影',
    'Street photography': '街头摄影',
    'Landscape photography': '风景摄影',
    'Wildlife photography': '野生动物摄影',
    'Fashion photography': '时尚摄影',
    'Product photography': '产品摄影',
    'Food photography': '美食摄影',
    'Travel photography': '旅行摄影',
    'Documentary': '纪实',
    'Fine art': '艺术摄影',
    'Experimental': '实验性'
};

// ========================================
// SEASONAL TAGS CONFIGURATION
// ========================================
const SEASONAL_HOLIDAYS = [
    // Format: { name, nameZh, month, day, icon, keywords }
    // month: 1-12, day: 1-31
    // For lunar calendar holidays, we pre-calculate dates for current/next years
    { name: 'Christmas', nameZh: '圣诞', month: 12, day: 25, icon: '🎄', keywords: ['christmas', 'xmas', 'santa', '圣诞', '圣诞节'] },
    { name: 'New Year', nameZh: '元旦', month: 1, day: 1, icon: '🎆', keywords: ['new year', 'newyear', '元旦', '新年', '跨年'] },
    { name: 'Valentine', nameZh: '情人节', month: 2, day: 14, icon: '💕', keywords: ['valentine', 'love', 'heart', '情人节', '爱情', '浪漫'] },
    { name: 'Halloween', nameZh: '万圣节', month: 10, day: 31, icon: '🎃', keywords: ['halloween', 'spooky', 'ghost', '万圣节', '鬼', '南瓜'] },
    { name: 'Mid-Autumn', nameZh: '中秋', month: 9, day: 17, icon: '🌕', keywords: ['mid-autumn', 'moon', 'mooncake', '中秋', '月饼', '赏月'] }, // 2024 date, update yearly
    { name: 'Dragon Boat', nameZh: '端午', month: 6, day: 10, icon: '🐲', keywords: ['dragon boat', '端午', '粽子', '龙舟'] }, // 2024 date
    { name: 'Labor Day', nameZh: '劳动节', month: 5, day: 1, icon: '👷', keywords: ['labor', 'may day', '劳动节', '五一'] },
    { name: 'Children', nameZh: '儿童节', month: 6, day: 1, icon: '🧸', keywords: ['children', 'kids', '儿童节', '六一', '童趣'] },
    { name: 'National Day', nameZh: '国庆', month: 10, day: 1, icon: '🇨🇳', keywords: ['national day', '国庆', '国庆节', '十一'] },
    { name: 'Thanksgiving', nameZh: '感恩节', month: 11, day: 28, icon: '🦃', keywords: ['thanksgiving', 'thanks', '感恩节', '感恩'] }, // Approximate
    { name: 'Mother Day', nameZh: '母亲节', month: 5, day: 12, icon: '💐', keywords: ['mother', 'mom', '母亲节', '妈妈'] }, // 2024 date
    { name: 'Father Day', nameZh: '父亲节', month: 6, day: 16, icon: '👔', keywords: ['father', 'dad', '父亲节', '爸爸'] }, // 2024 date
];

// Spring Festival dates (Lunar New Year - changes yearly)
// Pre-calculated for 2024-2026
const SPRING_FESTIVAL_DATES = {
    2024: { month: 2, day: 10 },
    2025: { month: 1, day: 29 },
    2026: { month: 2, day: 17 },
    2027: { month: 2, day: 6 },
};

/**
 * Get active seasonal holiday if within range (2 days before to day of)
 * @returns {Object|null} Holiday object or null
 */
function getActiveSeasonalHoliday() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();

    // Check Spring Festival first (special handling for lunar calendar)
    const springFestival = SPRING_FESTIVAL_DATES[currentYear];
    if (springFestival) {
        const daysUntil = getDaysUntil(currentMonth, currentDay, springFestival.month, springFestival.day);
        if (daysUntil >= 0 && daysUntil <= 2) {
            return {
                name: 'Spring Festival',
                nameZh: '春节',
                icon: '🧧',
                keywords: ['spring festival', 'chinese new year', 'lunar', '春节', '新春', '过年', '红包', '年味'],
                daysUntil
            };
        }
    }

    // Check other holidays
    for (const holiday of SEASONAL_HOLIDAYS) {
        const daysUntil = getDaysUntil(currentMonth, currentDay, holiday.month, holiday.day);
        if (daysUntil >= 0 && daysUntil <= 2) {
            return { ...holiday, daysUntil };
        }
    }

    return null;
}

/**
 * Calculate days until a target date (same year, simple calculation)
 */
function getDaysUntil(currentMonth, currentDay, targetMonth, targetDay) {
    const now = new Date();
    const currentYear = now.getFullYear();

    const current = new Date(currentYear, currentMonth - 1, currentDay);
    let target = new Date(currentYear, targetMonth - 1, targetDay);

    // If target has passed this year, check if we're still "on" the day
    const diffTime = target - current;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
}

function generateDynamicNav() {
    const navContainer = document.getElementById('navItems');
    if (!navContainer || !PROMPTS) return;

    // Check for active seasonal holiday
    const activeHoliday = getActiveSeasonalHoliday();

    // Count tag frequency
    const tagCounts = {};
    PROMPTS.forEach(prompt => {
        if (prompt.tags && Array.isArray(prompt.tags)) {
            prompt.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });

    // Sort by frequency and take top categories
    // If seasonal holiday is active, take 5 regular tags; otherwise take 6
    const maxRegularTags = activeHoliday ? 5 : 6;
    const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxRegularTags)
        .map(([tag]) => tag);

    // Build nav HTML
    let navHTML = `
        <div class="nav-item active" data-filter="all">
            <span class="en">All</span>
            <span class="cn">全部</span>
        </div>
    `;

    // Add seasonal tag first (if active) with special styling
    if (activeHoliday) {
        const statusText = activeHoliday.daysUntil === 0 ? '今天!' :
            activeHoliday.daysUntil === 1 ? '明天' : '即将';
        navHTML += `
            <div class="nav-item seasonal-tag" data-filter="seasonal:${activeHoliday.name}" data-keywords="${activeHoliday.keywords.join(',')}">
                <span class="en">${activeHoliday.icon} ${activeHoliday.name}</span>
                <span class="cn">${activeHoliday.nameZh} <small>${statusText}</small></span>
            </div>
        `;
    }

    topTags.forEach(tag => {
        const cn = TAG_TRANSLATIONS[tag] || tag;
        navHTML += `
            <div class="nav-item" data-filter="${tag}">
                <span class="en">${tag}</span>
                <span class="cn">${cn}</span>
            </div>
        `;
    });

    // Add Saved/Favorites at the end
    navHTML += `
        <div class="nav-item favorites-tab" data-filter="favorites">
            <span class="en">Saved</span>
            <span class="cn">收藏</span>
        </div>
    `;

    navContainer.classList.remove('nav-items--skeleton');
    navContainer.classList.add('nav-items--hydrated');
    navContainer.innerHTML = navHTML;

    // Store for back navigation
    originalNavHTML = navContainer.innerHTML;

    // Mark as loaded for fade-in
    navContainer.classList.add('loaded');
}

// ========================================
// AMBIENT LIGHT SYSTEM (Living Background)
// ========================================
function initAmbientLight() {
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationId;
    let blobs = [];

    // Resize canvas
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Color extraction from visible cards
    function getVisibleCardColors() {
        const cards = document.querySelectorAll('.prompt-card');
        const colors = [];
        const viewportHeight = window.innerHeight;

        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            // Only cards in viewport
            if (rect.top < viewportHeight && rect.bottom > 0) {
                const item = PROMPTS[parseInt(card.dataset.id)];
                if (item && item.dominantColors && item.dominantColors.length > 0) {
                    colors.push(...item.dominantColors.slice(0, 2));
                }
            }
        });

        return colors.length > 0 ? colors : ['#9b5de5', '#8b5cf6', '#a78bfa'];
    }

    // Create blob class
    class Blob {
        constructor(color) {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.radius = 200 + Math.random() * 300;
            this.color = color;
            this.vx = (Math.random() - 0.5) * 0.3;
            this.vy = (Math.random() - 0.5) * 0.3;
            this.targetColor = color;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;

            // Bounce off edges
            if (this.x < -this.radius || this.x > canvas.width + this.radius) this.vx *= -1;
            if (this.y < -this.radius || this.y > canvas.height + this.radius) this.vy *= -1;
        }

        draw() {
            const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
            gradient.addColorStop(0, this.hexToRgba(this.color, 0.3));
            gradient.addColorStop(1, this.hexToRgba(this.color, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        hexToRgba(hex, alpha) {
            if (hex.startsWith('rgb')) return hex.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
            const r = parseInt(hex.slice(1, 3), 16) || 155;
            const g = parseInt(hex.slice(3, 5), 16) || 93;
            const b = parseInt(hex.slice(5, 7), 16) || 229;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }

    // Initialize blobs
    const initialColors = ['#9b5de5', '#8b5cf6', '#a78bfa', '#c4b5fd'];
    for (let i = 0; i < 4; i++) {
        blobs.push(new Blob(initialColors[i % initialColors.length]));
    }

    // Update blob colors periodically
    function updateBlobColors() {
        const colors = getVisibleCardColors();
        blobs.forEach((blob, i) => {
            blob.color = colors[i % colors.length] || blob.color;
        });
    }

    // Animation loop
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        blobs.forEach(blob => {
            blob.update();
            blob.draw();
        });

        animationId = requestAnimationFrame(animate);
    }

    animate();

    // Update colors on scroll
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(updateBlobColors, 100);
    });

    // Initial color update
    setTimeout(updateBlobColors, 1000);
}

// ========================================
// STARRY SKY (Dark Mode Embellishment)
// ========================================
// NOTE: Starry sky animation is now in starry-sky.js shared module
// Function stub for backward compatibility - actual implementation loaded externally
function initStarrySky() {
    // Handled by starry-sky.js - this stub prevents errors if called
    console.log('Starry sky handled by starry-sky.js module');
}

// ========================================
// FEATURED BANNER (Today's Featured)
// ========================================
function getPromptHomepageBannerSite() {
    return window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
}

function getPromptHomepagePrefetchCacheKey(site = getPromptHomepageBannerSite()) {
    return `homepage_prefetch_${site === 'intl' ? 'intl' : 'cn'}`;
}

function readPromptHomepagePrefetchConfig(site = getPromptHomepageBannerSite()) {
    try {
        const raw = sessionStorage.getItem(getPromptHomepagePrefetchCacheKey(site));
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (parsed?.site && parsed.site !== site) {
            return null;
        }

        return parsed?.config && typeof parsed.config === 'object' ? parsed.config : null;
    } catch (error) {
        return null;
    }
}

function normalizeHomepageFeaturedBannerItems(value) {
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
                title: String(item.title || item.title_zh || item.title_en || '').trim(),
                image: String(item.image || item.image_url || '').trim()
            };
        })
        .filter(Boolean);
}

async function loadHomepagePromptsConfigForBanner(site = getPromptHomepageBannerSite()) {
    const prefetchedConfig = readPromptHomepagePrefetchConfig(site);
    if (!window.supabaseClient) {
        return prefetchedConfig;
    }

    try {
        const { data, error } = await window.supabaseClient
            .rpc('fn_get_homepage_config', {
                p_site: site,
                p_include_hidden: true
            });

        if (error) {
            throw error;
        }

        const config = {};
        (Array.isArray(data) ? data : []).forEach((item) => {
            const section = String(item?.section || '').trim();
            if (!section) return;
            config[section] = item?.content && typeof item.content === 'object'
                ? item.content
                : {};
        });

        return Object.keys(config).length ? config : prefetchedConfig;
    } catch (error) {
        console.warn('[Prompts] Failed to load homepage config for featured banner:', error?.message || error);
        return prefetchedConfig;
    }
}

function findPromptByHomepageFeaturedItemId(featuredItemId = '') {
    const normalizedId = String(featuredItemId || '').trim();
    if (!normalizedId || !Array.isArray(PROMPTS) || PROMPTS.length === 0) {
        return null;
    }

    let prompt = PROMPTS.find((item) => String(item?.supabaseId || item?.id || '').trim() === normalizedId);
    if (prompt) {
        return prompt;
    }

    const numericId = Number.parseInt(normalizedId, 10);
    if (!Number.isNaN(numericId)) {
        prompt = PROMPTS.find((item) => item?.supabaseId === numericId || item?.id === numericId);
    }

    return prompt || null;
}

function resolveHomepageFeaturedBannerPrompt(config = null) {
    if (config?.prompts?.enable_auto !== false) {
        return null;
    }

    const featuredItems = normalizeHomepageFeaturedBannerItems(config?.prompts?.featured_items);
    for (const item of featuredItems) {
        const prompt = findPromptByHomepageFeaturedItemId(item.id);
        if (prompt) {
            return prompt;
        }
    }
    return null;
}

function resolveDailyFeaturedPrompt() {
    if (!Array.isArray(PROMPTS) || PROMPTS.length === 0) {
        return null;
    }

    const today = new Date().toDateString();
    const seed = today.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const randomIndex = seed % PROMPTS.length;
    return PROMPTS[randomIndex] || null;
}

function buildFeaturedBannerDescription(featured = {}) {
    const localizedDescription = String(getLocalizedField(featured, 'description') || '').trim();
    if (localizedDescription) {
        return localizedDescription;
    }

    const aiTags = featured?.aiTags;
    if (!aiTags || typeof aiTags !== 'object') {
        return '';
    }

    const currentLanguage = getCurrentLanguage();
    const fallbackLanguage = currentLanguage === 'en' ? 'zh' : 'en';
    const mood = aiTags.mood?.[currentLanguage]?.[0] || aiTags.mood?.[fallbackLanguage]?.[0] || '';
    const style = aiTags.styles?.[currentLanguage]?.[0] || aiTags.styles?.[fallbackLanguage]?.[0] || '';
    const scene = aiTags.scenes?.[currentLanguage]?.[0] || aiTags.scenes?.[fallbackLanguage]?.[0] || '';

    let description = '';
    if (mood && style && currentLanguage === 'en') {
        description = `A ${mood.toLowerCase()} piece with ${style.toLowerCase()} aesthetics`;
        if (scene) description += `, featuring ${scene.toLowerCase()}`;
        description += '.';
    } else if (mood && style) {
        description = `${mood}氛围的${style}作品`;
        if (scene) description += `，主题围绕${scene}`;
        description += '。';
    }

    return description;
}

function applyFeaturedBannerPrompt(featured = null) {
    const banner = document.getElementById('featuredBanner');
    const image = document.getElementById('featuredImage');
    const title = document.getElementById('featuredTitle');
    const description = document.getElementById('featuredDescription');

    if (!banner) return;

    banner.classList.remove('featured-banner--loading');

    if (!featured) {
        banner.classList.remove('featured-banner--visible', 'featured-banner--revealed', 'featured-banner--interactive');
        banner.onclick = null;
        banner.dataset.promptId = '';
        return Promise.resolve(false);
    }

    const nextPromptId = String(featured?.supabaseId || featured?.id || '').trim();
    const currentPromptId = String(banner.dataset.promptId || '').trim();
    const isSamePrompt = currentPromptId && nextPromptId && currentPromptId === nextPromptId;

    banner.classList.add('featured-banner--visible', 'featured-banner--interactive');
    banner.dataset.promptId = nextPromptId;

    if (!isSamePrompt) {
        banner.classList.remove('featured-banner--revealed');
        requestAnimationFrame(() => {
            banner.classList.add('featured-banner--revealed');
            forcePromptPageTop();
        });
    } else {
        banner.classList.add('featured-banner--revealed');
    }

    // Set image (use first image from the array)
    let featuredImagePromise = Promise.resolve(false);
    const featuredImageAsset = getPromptPrimaryImageAsset(featured);
    if (image && featuredImageAsset) {
        featuredImagePromise = setFeaturedBannerImageSource(image, featuredImageAsset);
        image.loading = 'eager';
        image.decoding = 'async';
        image.setAttribute('fetchpriority', 'high');
        if ('fetchPriority' in image) {
            image.fetchPriority = 'high';
        }
    } else if (image) {
        clearFeaturedBannerImageSource(image);
    }

    // Set title
    if (title) {
        title.textContent = getLocalizedField(featured, 'title') || featured.title || '';
    }

    if (description) {
        description.textContent = buildFeaturedBannerDescription(featured);
    }

    // Click to open modal
    banner.onclick = () => openPromptModal(featured.id);
    return featuredImagePromise;
}

async function renderFeaturedBanner(options = {}) {
    const banner = document.getElementById('featuredBanner');
    if (!banner) return;

    if (!Array.isArray(PROMPTS) || PROMPTS.length === 0) {
        applyFeaturedBannerPrompt(null);
        return;
    }

    const prefetchedHomepageConfig = readPromptHomepagePrefetchConfig();
    const prefetchedConfiguredFeatured = resolveHomepageFeaturedBannerPrompt(prefetchedHomepageConfig);
    const immediateFeatured = prefetchedConfiguredFeatured || resolveDailyFeaturedPrompt();
    const immediateImagePromise = applyFeaturedBannerPrompt(immediateFeatured);
    const configuredUpdatePromise = renderFeaturedBannerConfiguredUpdate(immediateFeatured);

    if (options.waitForFirstImage === true) {
        await waitForPromptFeaturedFirstImage(immediateImagePromise);
        void configuredUpdatePromise.catch((error) => {
            console.warn('[Prompts] Featured banner configured update failed:', error?.message || error);
        });
        return;
    }

    await configuredUpdatePromise;
}

// ========================================
// SCROLL REVEAL ANIMATION (Wave Effect)
// ========================================
function setupScrollReveal() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // Stagger delay based on position
                const card = entry.target;
                const rect = card.getBoundingClientRect();
                const column = Math.floor(rect.left / 350); // Approximate column
                const delay = column * 0.05; // 50ms stagger per column

                setTimeout(() => {
                    card.classList.add('visible');
                }, delay * 1000);

                observer.unobserve(card);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '50px'
    });

    // Observe all cards (will be called after cards render)
    window.observeCards = () => {
        document.querySelectorAll('.prompt-card.scroll-reveal').forEach(card => {
            observer.observe(card);
        });
    };
}

// --- Spotlight Effect ---
function initSpotlight() {
    const container = document.querySelector('.poetry-nav-container');
    if (!container) return;

    container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setPromptsCssVars(container, {
            '--cursor-x': `${x}px`,
            '--cursor-y': `${y}px`
        });
    });
}

// --- Pagination State ---
let CARDS_PER_PAGE = 20; // Default: 5 rows * 4 columns
let currentPage = 1;
let currentFilter = 'all';
let isLoading = false;
let allFilteredItems = [];
let allCardsRendered = false; // Track if all cards have been rendered
let renderedCards = new Map(); // Cache rendered cards by id

// Load gallery config from system_config
let DEFAULT_SORT = 'newest'; // Default sort order

async function loadGalleryConfig(options = {}) {
    try {
        if (!window.supabaseClient) return null;

        const cancellationToken = options.cancellationToken || null;
        const previousCardsPerPage = CARDS_PER_PAGE;
        const previousSort = DEFAULT_SORT;

        const { data, error } = await window.supabaseClient
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'gallery')
            .single();

        if (cancellationToken?.cancelled) {
            return null;
        }

        if (!error && data && data.config_value) {
            const config = data.config_value;
            if (config.items_per_page) {
                CARDS_PER_PAGE = parseInt(config.items_per_page) || 24;
            }
            if (config.default_sort) {
                DEFAULT_SORT = config.default_sort;
            }
            console.log('📋 画廊配置已加载: CARDS_PER_PAGE =', CARDS_PER_PAGE, ', DEFAULT_SORT =', DEFAULT_SORT);

            // Apply initial sorting to PROMPTS
            sortPrompts(DEFAULT_SORT);

            return {
                cardsPerPageChanged: previousCardsPerPage !== CARDS_PER_PAGE,
                defaultSortChanged: previousSort !== DEFAULT_SORT
            };
        }

        return {
            cardsPerPageChanged: false,
            defaultSortChanged: false
        };
    } catch (e) {
        console.warn('加载画廊配置失败:', e);
        return null;
    }
}

function loadGalleryConfigForFirstRender() {
    const cancellationToken = { cancelled: false };
    const configPromise = loadGalleryConfig({ cancellationToken });
    const timeoutPromise = new Promise((resolve) => {
        window.setTimeout(() => {
            cancellationToken.cancelled = true;
            resolve(null);
        }, PROMPT_GALLERY_CONFIG_FIRST_RENDER_TIMEOUT_MS);
    });

    return Promise.race([
        configPromise.catch(() => null),
        timeoutPromise
    ]);
}

function applyLoadedGalleryConfig(configResult) {
    if (!configResult || (!configResult.cardsPerPageChanged && !configResult.defaultSortChanged)) {
        return;
    }

    renderGallery(currentFilter || 'all', true);
}

// Sort PROMPTS array based on sort type
function sortPrompts(sortType) {
    if (!PROMPTS || PROMPTS.length === 0) return;

    // Helper: Extract numeric id from string format like "prompt-123"
    const getNumericId = (item) => {
        const rawId = item?.supabaseId || item?.id;
        if (!rawId) return 0;
        if (typeof rawId === 'number') return rawId;
        // Extract number from string like "prompt-42"
        const match = String(rawId).match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    };

    // Helper: Get favorites count from localStorage (used for 'popular' sorting)
    const getFavoritesCount = () => {
        try {
            // Load all favorites data from localStorage
            const storedFavorites = JSON.parse(localStorage.getItem('promptFavorites') || '[]');
            // Count how many times each prompt appears in all users' favorites
            // For now, we use a simple approach: check if the prompt is in the current user's favorites
            const favSet = new Set(storedFavorites);
            return favSet;
        } catch (e) {
            return new Set();
        }
    };

    switch (sortType) {
        case 'newest':
            // Sort by createdAt date first, fallback to numeric id (higher = newer)
            PROMPTS.sort((a, b) => {
                // If there's a createdAt field, use it
                if (a.createdAt && b.createdAt) {
                    return new Date(b.createdAt) - new Date(a.createdAt);
                }
                // Otherwise, extract numeric id and sort descending (newer items have higher ids)
                return getNumericId(b) - getNumericId(a);
            });
            break;
        case 'popular':
            // Sort by favorites count (prioritize favorited items, then by id)
            const favSet = getFavoritesCount();
            PROMPTS.sort((a, b) => {
                // Check if items are favorited
                const aFav = favSet.has(a.id) ? 1 : 0;
                const bFav = favSet.has(b.id) ? 1 : 0;

                // If both have same favorite status, sort by explicit likes/favCount
                if (aFav === bFav) {
                    const aLikes = a.likes || a.favCount || 0;
                    const bLikes = b.likes || b.favCount || 0;
                    if (aLikes !== bLikes) return bLikes - aLikes;
                    // Fallback to id order
                    return getNumericId(b) - getNumericId(a);
                }
                // Favorited items come first
                return bFav - aFav;
            });
            break;
        case 'random':
            // Fisher-Yates shuffle
            for (let i = PROMPTS.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [PROMPTS[i], PROMPTS[j]] = [PROMPTS[j], PROMPTS[i]];
            }
            break;
        default:
            // Default to newest if unknown sort type
            sortPrompts('newest');
    }

    invalidatePromptSearchCaches();
    console.log('🔄 画廊已排序:', sortType);
}

// --- Favorites System (Pinterest-style) ---
let favorites = new Set(JSON.parse(localStorage.getItem('promptFavorites') || '[]'));

function saveFavorites() {
    localStorage.setItem('promptFavorites', JSON.stringify([...favorites]));
}

function toggleFavorite(id, btn, e) {
    e.stopPropagation();
    e.stopImmediatePropagation(); // Ensure no other click listeners fire

    // Trigger bounce animation
    btn.classList.add('animating');
    setTimeout(() => btn.classList.remove('animating'), 400);

    if (favorites.has(id)) {
        favorites.delete(id);
        btn.classList.remove('saved');
    } else {
        favorites.add(id);
        btn.classList.add('saved');
    }
    saveFavorites();

    // If viewing favorites, remove card if unsaved
    if (currentFilter === 'favorites' && !favorites.has(id)) {
        const card = btn.closest('.prompt-card');
        hidePromptCard(card, true);
    }
}

// --- Render Gallery ---
function renderGallery(filter, reset = true) {
    const grid = document.querySelector('.gallery-container');
    if (!grid) return;

    currentFilter = filter;

    // Reset pagination state when filtering
    if (reset) {
        currentPage = 1; // Start at page 1 for standard pagination
        // Filter items based on current filter
        if (filter === 'favorites') {
            allFilteredItems = PROMPTS.filter(p => favorites.has(p.id));
        } else if (filter === 'all') {
            allFilteredItems = [...PROMPTS];
        } else {
            // Filter by category tag OR AI tags (for sub-tag filtering)
            const filterLower = filter.toLowerCase();
            allFilteredItems = PROMPTS.filter(p => {
                // Check main tags array
                if (p.tags && p.tags.some(t => t.toLowerCase() === filterLower)) {
                    return true;
                }
                // Check AI tags (styles, mood, scenes, objects)
                if (p.aiTags) {
                    const checkTags = (tags) => {
                        if (!tags) return false;
                        return ['en', 'zh'].some(lang =>
                            tags[lang] && tags[lang].some(t => t.toLowerCase().includes(filterLower))
                        );
                    };
                    if (checkTags(p.aiTags.styles) ||
                        checkTags(p.aiTags.mood) ||
                        checkTags(p.aiTags.scenes) ||
                        checkTags(p.aiTags.objects)) {
                        return true;
                    }
                }
                return false;
            });
        }
    }

    renderCurrentPage();
    document.documentElement.classList.remove('prompts-gallery-pending');
}

function renderCurrentPage() {
    const grid = document.querySelector('.gallery-container');
    if (!grid) return;

    // Clear grid for standard pagination
    grid.innerHTML = '';
    window.scrollTo({ top: 0, behavior: shouldForcePromptPageTop() ? 'auto' : 'smooth' });

    const totalItems = allFilteredItems.length;
    const totalPages = Math.ceil(totalItems / CARDS_PER_PAGE);

    // Ensure currentPage is valid
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;

    const startIndex = (currentPage - 1) * CARDS_PER_PAGE;
    const endIndex = Math.min(startIndex + CARDS_PER_PAGE, totalItems);
    const itemsToLoad = allFilteredItems.slice(startIndex, endIndex);

    if (itemsToLoad.length === 0 && totalItems > 0) return;

    isLoading = true;
    warmPromptGalleryLeadImages(itemsToLoad);

    itemsToLoad.forEach((item, index) => {
        const imageAssets = getPromptImageAssets(item);
        const primaryImageAsset = imageAssets[0] || null;
        const shouldLoadImageEagerly = index < PROMPT_GALLERY_EAGER_IMAGE_COUNT;
        const card = document.createElement('div');
        card.className = 'prompt-card card-enter prompt-card--loading';
        card.dataset.tags = item.tags.join(','); // For CSS filtering
        card.dataset.id = item.id;
        card.dataset.images = JSON.stringify(imageAssets); // Store all images
        card.onclick = () => openPromptModal(item.id);
        setPromptCardStaggerClass(card, index);

        // Generate image indicator dots if multiple images
        const hasMultiple = imageAssets.length > 1;
        const indicators = hasMultiple
            ? `<div class="card-indicators">${imageAssets.map((_, i) => `<span class="indicator-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
            : '';

        // Check if item is already saved
        const isSaved = favorites.has(item.id);

        // Random breathing delay for organic feel (0-4 seconds)
        const breatheDelay = (Math.random() * 4).toFixed(2);
        setPromptsCssVars(card, {
            '--breathe-delay': `${breatheDelay}s`
        });

        card.innerHTML = `
            ${buildPromptCardSkeletonMarkup(index)}
            <button class="card-fav-btn ${isSaved ? 'saved' : ''}" type="button">
                <i class="fas fa-heart"></i>
            </button>
            <img class="card-image" loading="${shouldLoadImageEagerly ? 'eager' : 'lazy'}" decoding="async" alt="${getLocalizedField(item, 'title')}">
            <div class="card-overlay">
                <div class="card-title">${getLocalizedField(item, 'title')}</div>
                ${indicators}
            </div>
        `;

        const favoriteButton = card.querySelector('.card-fav-btn');
        favoriteButton?.addEventListener('click', (event) => {
            toggleFavorite(item.id, favoriteButton, event);
        });

        const cardImage = card.querySelector('.card-image');
        if (cardImage) {
            cardImage.loading = shouldLoadImageEagerly ? 'eager' : 'lazy';
            cardImage.decoding = 'async';
            cardImage.setAttribute('fetchpriority', shouldLoadImageEagerly ? 'high' : 'auto');
            if ('fetchPriority' in cardImage) {
                cardImage.fetchPriority = shouldLoadImageEagerly ? 'high' : 'auto';
            }
            setPromptCardImageSource(cardImage, primaryImageAsset);
        }
        cardImage?.addEventListener('load', () => {
            markPromptCardImageReady(card, cardImage);
        });
        cardImage?.addEventListener('error', () => {
            const transformFallbackSrc = cardImage.dataset.transformFallbackSrc;
            const originalSrc = cardImage.dataset.originalSrc || getPromptImageAssetOriginalUrl(primaryImageAsset);

            if (!cardImage.dataset.fallbackStage && transformFallbackSrc && cardImage.src !== transformFallbackSrc) {
                cardImage.dataset.fallbackStage = 'transform';
                cardImage.src = transformFallbackSrc;
                return;
            }

            if (
                cardImage.dataset.fallbackStage !== 'original'
                && originalSrc
                && !isSupabaseStorageImageUrl(originalSrc)
                && cardImage.src !== originalSrc
            ) {
                cardImage.dataset.fallbackStage = 'original';
                cardImage.src = originalSrc;
                return;
            }

            markPromptCardImageReady(card, cardImage);
        });
        if (cardImage?.complete && cardImage.naturalWidth > 0) {
            markPromptCardImageReady(card, cardImage);
        }

        // Add hover carousel for cards with multiple images
        if (hasMultiple) {
            let hoverInterval = null;
            let currentIndex = 0;

            card.addEventListener('mouseenter', () => {
                const img = card.querySelector('.card-image');
                const dots = card.querySelectorAll('.indicator-dot');
                const images = JSON.parse(card.dataset.images);

                hoverInterval = setInterval(() => {
                    currentIndex = (currentIndex + 1) % images.length;
                    setPromptCardImageSource(img, images[currentIndex]);
                    dots.forEach((dot, i) => dot.classList.toggle('active', i === currentIndex));
                }, 1500);
            });

            card.addEventListener('mouseleave', () => {
                clearInterval(hoverInterval);
                currentIndex = 0;
                const img = card.querySelector('.card-image');
                const dots = card.querySelectorAll('.indicator-dot');
                const images = JSON.parse(card.dataset.images);
                setPromptCardImageSource(img, images[0]);
                dots.forEach((dot, i) => dot.classList.toggle('active', i === 0));
            });
        }

            grid.appendChild(card);

            // Trigger animation with stagger delay
            const staggerDelay = index * 50;
            const visibleIndex = index;
            setTimeout(() => {
	            showPromptCard(card, visibleIndex);
	            setTimeout(() => {
	                card.classList.add('breathing');
	            }, 850);
	        }, staggerDelay);
    });

    isLoading = false;

    // Show container
    requestAnimationFrame(() => {
        grid.classList.add('visible');
        forcePromptPageTop();
    });

    // Render Pagination Controls
    renderPaginationControls(totalPages);
}

function renderPaginationControls(totalPages) {
    const existingNav = document.querySelector('.pagination-nav');
    if (existingNav) existingNav.remove();

    const grid = document.querySelector('.gallery-container');
    if (!grid || totalPages <= 1) return;

    const nav = document.createElement('div');
    nav.className = 'pagination-nav prompts-pagination-nav';

    // Helper to create button
    const createBtn = (text, page, isActive = false, isDisabled = false) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = `pagination-btn${isActive ? ' active' : ''}`;
        if (isDisabled) btn.disabled = true;

        if (!isDisabled && !isActive) {
            btn.addEventListener('click', () => {
                currentPage = page;
                renderCurrentPage();
            });
        }
        return btn;
    };

    // Prev Button
    nav.appendChild(createBtn('← Prev', currentPage - 1, false, currentPage === 1));

    // Page Numbers
    // Simple logic: Show first, last, and around current
    // Pattern: 1 ... 4 5 6 ... 10
    const range = [];

    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) range.push(i);
    } else {
        range.push(1);
        if (currentPage > 3) range.push('...');

        let start = Math.max(2, currentPage - 1);
        let end = Math.min(totalPages - 1, currentPage + 1);

        if (currentPage === 1) end = 3;
        if (currentPage === totalPages) start = totalPages - 2;

        for (let i = start; i <= end; i++) range.push(i);

        if (currentPage < totalPages - 2) range.push('...');
        range.push(totalPages);
    }

    range.forEach(p => {
        if (p === '...') {
            const span = document.createElement('span');
            span.textContent = '...';
            span.className = 'pagination-ellipsis';
            nav.appendChild(span);
        } else {
            nav.appendChild(createBtn(String(p), p, p === currentPage));
        }
    });

    // Next Button
    nav.appendChild(createBtn('Next →', currentPage + 1, false, currentPage === totalPages));

    grid.parentNode.insertBefore(nav, grid.nextSibling);

    // Animate in
    nav.animate([
        { opacity: 0, transform: 'translateY(20px)' },
        { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 500, easing: 'ease-out', fill: 'forwards' });
}

// Filter cards using CSS classes for smooth animations (Only used for filter switching animations if staying on same page, but we are resetting page now)
// We can simplify this or keep it for small transitions, but standard pagination usually redraws.
// Keeping a simplified version for small updates if needed, but renderGallery now resets.

function loadMoreCards() {
    // Deprecated for pagination
    renderCurrentPage();
}

// --- Infinite Scroll ---
function setupInfiniteScroll() {
    // Disabled in favor of Pagination
    /*
    window.addEventListener('scroll', () => {
        if (isLoading) return;

        const scrollY = window.scrollY;
        const windowHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;

        // Load more when near bottom (200px threshold)
        if (scrollY + windowHeight >= docHeight - 200) {
            loadMoreCards();
        }
    });
    */
    console.log('Infinite scroll disabled, using pagination.');
}

// --- Filter Interactivity ---
let isInSubNav = false;
let originalNavHTML = '';

function setupFilters() {
    const navItems = document.querySelectorAll('.nav-item');
    const navContainer = document.querySelector('.nav-items');

    // Store original nav for back navigation
    if (navContainer) {
        originalNavHTML = navContainer.innerHTML;
    }

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const filterType = item.getAttribute('data-filter');
            handleNavClick(filterType, item);
        });
    });
}

// Handle navigation clicks (both main and sub-nav)
function handleNavClick(filterType, clickedItem) {
    const navItems = document.querySelectorAll('.nav-item');
    const navContainer = document.querySelector('.nav-items');
    const searchInput = document.getElementById('gallerySearch');

    // Clear search
    if (searchInput) searchInput.value = '';

    // Special handling for back button
    if (filterType === 'back') {
        returnToMainNav();
        return;
    }

    // Update active state
    navItems.forEach(n => n.classList.remove('active'));
    clickedItem.classList.add('active');

    // If clicking a main category (not 'all', not 'favorites'), show AI sub-tags
    const mainCategories = ['Miniature', 'Photography', 'Illustration', '3D Art', 'Creative'];
    if (!isInSubNav && mainCategories.includes(filterType)) {
        showAISubTags(filterType, navContainer);
    }

    // Always reset to page 1 and render
    renderGallery(filterType, true);
}

// Get AI-derived sub-tags for a category (with Chinese translations from aiTags)
function getAISubTags(category) {
    // Filter prompts by category
    const categoryPrompts = PROMPTS.filter(p => Array.isArray(p.tags) && p.tags.includes(category));

    // Aggregate all AI tags with their Chinese translations
    const tagData = {}; // { normalizedTag: { count: number, en: string, zh: string } }

    categoryPrompts.forEach(prompt => {
        const aiTags = getPromptAiTags(prompt);
        if (!Object.keys(aiTags).length) return;

        const addTag = (tag, zhTag = '') => {
            const normalized = normalizePromptTagText(tag).toLowerCase();
            if (normalized.length <= 2) {
                return;
            }
            if (!tagData[normalized]) {
                tagData[normalized] = {
                    count: 0,
                    en: tag.charAt(0).toUpperCase() + tag.slice(1),
                    zh: zhTag || ''
                };
            }
            tagData[normalized].count++;
            if (!tagData[normalized].zh && zhTag) {
                tagData[normalized].zh = zhTag;
            }
        };

        // Collect bilingual visual tags and keep their Chinese pair where available.
        const collectPairedTags = (tagObj) => {
            if (!tagObj || !tagObj.en) return;
            const enTags = tagObj.en;
            const zhTags = tagObj.zh || [];

            enTags.forEach((tag, index) => {
                addTag(tag, zhTags[index] || '');
            });
        };

        const collectPlainTags = (values) => {
            getPromptPlainTagList(values).forEach((tag) => addTag(tag));
        };

        PROMPT_AI_PAIRED_TAG_FIELDS.forEach((field) => collectPairedTags(aiTags[field]));
        collectPlainTags(aiTags.useCase?.platform);
        collectPlainTags(aiTags.useCase?.purpose);
        collectPlainTags(aiTags.useCase?.format);
        collectPlainTags(aiTags.commercial?.niche);
        collectPlainTags(aiTags.commercial?.targetAudience);
        const difficultyLabel = getPromptDifficultyLabel(aiTags.difficulty);
        if (difficultyLabel) {
            addTag(difficultyLabel);
        }
    });

    // Sort by frequency and keep enough options to make the sub-nav useful.
    const sortedTags = Object.values(tagData)
        .sort((a, b) => b.count - a.count)
        .slice(0, PROMPT_HOT_TAG_LIMIT);

    return sortedTags; // Returns array of { en, zh, count }
}

// Show AI sub-tags in navigation
function showAISubTags(category, navContainer) {
    const subTags = getAISubTags(category);
    if (subTags.length === 0) return;

    isInSubNav = true;

    beginPromptsNavTransition(navContainer, 'prompts-nav-hidden-up');

    setTimeout(() => {
        // Build new sub-nav
        let subNavHTML = `
            <div class="nav-item back-nav" data-filter="back">
                <span class="en">← Back</span>
                <span class="cn">返回</span>
            </div>
        `;

        subTags.forEach((tagObj, i) => {
            // Use zh from aiTags data, fallback to TAG_TRANSLATIONS, then empty
            const cnTranslation = tagObj.zh || TAG_TRANSLATIONS[tagObj.en] || TAG_TRANSLATIONS[tagObj.en.toLowerCase()] || '';
            subNavHTML += `
                <div class="nav-item sub-tag ${buildPromptsStaggerClass(i)}" data-filter="${tagObj.en.toLowerCase()}">
                    <span class="en">${tagObj.en}</span>
                    ${cnTranslation ? `<span class="cn">${cnTranslation}</span>` : ''}
                </div>
            `;
        });

        navContainer.innerHTML = subNavHTML;

        // Attach click handlers to new items
        navContainer.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const filter = item.getAttribute('data-filter');
                handleNavClick(filter, item);
            });
        });

        finishPromptsNavTransition(navContainer, 'prompts-nav-hidden-down');
    }, 250);
}

// Return to main navigation
function returnToMainNav() {
    const navContainer = document.querySelector('.nav-items');

    isInSubNav = false;

    beginPromptsNavTransition(navContainer, 'prompts-nav-hidden-down');

    setTimeout(() => {
        navContainer.innerHTML = originalNavHTML;

        // Re-attach handlers
        navContainer.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const filter = item.getAttribute('data-filter');
                handleNavClick(filter, item);
            });
        });

        // Show all and set active
        const allItem = navContainer.querySelector('[data-filter="all"]');
        if (allItem) allItem.classList.add('active');

        if (allCardsRendered) {
            filterCardsCSS('all');
        } else {
            renderGallery('all');
        }

        finishPromptsNavTransition(navContainer, 'prompts-nav-hidden-up');
    }, 250);
}

// --- Pinterest-style Search with Dropdown ---
function setupSearch() {
    const searchInput = document.getElementById('gallerySearch');
    const dropdown = document.getElementById('searchDropdown');
    const hotTagsList = document.getElementById('hotTagsList');
    const hotTagsSection = document.getElementById('searchHotTags');
    const suggestionsSection = document.getElementById('searchSuggestions');

    if (!searchInput || !dropdown) return;

    let debounceTimer;
    let isDropdownActive = false;

    // Generate hot tags from PROMPTS data (with caching)
    function generateHotTags() {
        if (!hotTagsList || typeof PROMPTS === 'undefined') return;

        // Use cached tags if available
        if (HOT_TAGS_CACHE) {
            renderHotTags(HOT_TAGS_CACHE, hotTagsList, searchInput);
            return;
        }

        HOT_TAGS_CACHE = buildPromptHotTags(PROMPTS, PROMPT_HOT_TAG_LIMIT);

        renderHotTags(HOT_TAGS_CACHE, hotTagsList, searchInput);
    }

    // Render hot tags helper function
    function renderHotTags(topTags, container, searchInput) {
        container.innerHTML = topTags.map((tag, i) =>
            `<span class="hot-tag ${buildPromptsStaggerClass(i)}" data-tag="${tag}">${tag}</span>`
        ).join('');

        // Add mousedown handlers to hot tags (mousedown fires before document mousedown)
        container.querySelectorAll('.hot-tag').forEach(tagEl => {
            tagEl.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent text selection
                e.stopPropagation(); // Prevent dropdown from closing
                const tag = tagEl.dataset.tag;
                searchInput.value = tag;
                filterBySearch(tag.toLowerCase());
                hideDropdown();
            });
        });
    }

    // Show dropdown
    function showDropdown() {
        // Only show dropdown when user starts typing (handled by showSuggestions)
        // Don't show on empty focus
        const query = searchInput.value.trim();
        if (!query) {
            // Don't show dropdown when empty
            return;
        }

        if (isDropdownActive) return;
        isDropdownActive = true;
        dropdown.classList.add('active');
    }

    // Hide dropdown
    function hideDropdown() {
        isDropdownActive = false;
        dropdown.classList.remove('active');
    }

    // Show suggestions based on query
    function showSuggestions(query) {
        if (!suggestionsSection) return;

        // If no query, hide dropdown entirely (no more hot tags panel on focus)
        if (!query) {
            setPromptsHidden(hotTagsSection, true);
            setPromptsHidden(suggestionsSection, true);
            hideDropdown();
            return;
        }

        // Activate dropdown when typing
        if (!isDropdownActive) {
            isDropdownActive = true;
            dropdown.classList.add('active');
        }

        // Collect matching suggestions
        const suggestions = new Set();
        const lowerQuery = normalizePromptSearchText(query);

        PROMPTS.forEach(p => {
            collectPromptSearchValues({
                title: p.title,
                title_en: p.title_en,
                title_zh: p.title_zh,
                tags: p.tags,
                aiTags: p.aiTags || p.ai_tags
            }).forEach((value) => {
                if (normalizePromptSearchText(value).includes(lowerQuery)) {
                    suggestions.add(value);
                }
            });
        });

        const suggestionArray = Array.from(suggestions).slice(0, 5); // Reduced to 5 for inline tags

        // Always hide the old hot tags section
        setPromptsHidden(hotTagsSection, true);
        setPromptsHidden(suggestionsSection, false);

        // Build suggestions HTML
        let html = suggestionArray.map(s =>
            `<div class="suggestion-item"><i class="fas fa-search"></i>${s}</div>`
        ).join('');

        // Add 3 inline hot tag hints at the bottom
        const hotTags = getInlineHotTags(3);
        if (hotTags.length > 0) {
            // Add 'with-suggestions' class only when there are suggestions above
            const borderClass = suggestionArray.length > 0 ? 'with-suggestions' : '';
            html += `
                <div class="inline-hot-tags ${borderClass}">
                    <span class="inline-label">热门</span>
                    <div class="inline-hot-tags-list">
                        ${hotTags.map(tag => `<span class="inline-hot-tag" data-tag="${tag}">${tag}</span>`).join('')}
                    </div>
                </div>
            `;
        }

        suggestionsSection.innerHTML = html;

        // Add mousedown handlers for suggestions
        suggestionsSection.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                searchInput.value = item.textContent;
                filterBySearch(item.textContent.toLowerCase());
                hideDropdown();
            });
        });

        // Add mousedown handlers for inline hot tags
        suggestionsSection.querySelectorAll('.inline-hot-tag').forEach(tagEl => {
            tagEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const tag = tagEl.dataset.tag;
                searchInput.value = tag;
                filterBySearch(tag.toLowerCase());
                hideDropdown();
            });
        });
    }

    // Get inline hot tags (returns top N hot tags not matching current query)
    function getInlineHotTags(count) {
        if (!HOT_TAGS_CACHE) {
            HOT_TAGS_CACHE = buildPromptHotTags(PROMPTS, PROMPT_HOT_TAG_LIMIT);
        }
        return HOT_TAGS_CACHE.slice(0, count);
    }

    // Input event
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        // Show suggestions in dropdown
        showSuggestions(query);

        // Debounce for performance
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            filterBySearch(query.toLowerCase());
        }, 200);
    });

    // Focus event - show dropdown
    searchInput.addEventListener('focus', () => {
        showDropdown();
    });

    // Clear search on ESC
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            filterBySearch('');
            hideDropdown();
            searchInput.blur();
        }
    });

    // Click outside to close dropdown
    // CRITICAL: Use mousedown instead of click to prevent issues with element removal
    document.addEventListener('mousedown', (e) => {
        const searchWrapper = document.querySelector('.nav-search-wrapper');
        if (searchWrapper && !searchWrapper.contains(e.target)) {
            hideDropdown();
        }
    });

    // Prevent dropdown from closing when clicking inside it
    dropdown.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
}

async function filterBySearch(query) {
    const normalizedQuery = normalizePromptSearchText(query);
    const searchRequestId = ++PROMPT_SEARCH_REQUEST_ID;

    // If no query, show all cards
    if (!normalizedQuery) {
        renderGallery('all', true);
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const allItem = document.querySelector('.nav-item[data-filter="all"]');
        if (allItem) allItem.classList.add('active');
        return;
    }

    // Color matching map (supports both English and Chinese color names)
    const COLOR_MAP = {
        'red': ['red', '红', '红色'],
        'orange': ['orange', '橙', '橙色', '橘'],
        'yellow': ['yellow', '黄', '黄色'],
        'green': ['green', '绿', '绿色'],
        'blue': ['blue', '蓝', '蓝色'],
        'purple': ['purple', '紫', '紫色'],
        'pink': ['pink', '粉', '粉色', '粉红'],
        'brown': ['brown', '棕', '棕色', '褐色'],
        'black': ['black', '黑', '黑色'],
        'white': ['white', '白', '白色'],
        'gray': ['gray', 'grey', '灰', '灰色'],
        'cyan': ['cyan', '青', '青色']
    };

    // Check if query is a color search
    let searchingForColor = null;
    for (const [colorKey, aliases] of Object.entries(COLOR_MAP)) {
        if (aliases.some(alias => normalizedQuery.includes(alias))) {
            searchingForColor = colorKey;
            break;
        }
    }

    // === 3-LAYER SEARCH STRATEGY ===

    // Layer 1 & 2: Local search (instant, no network)
    const localResults = performLocalSearch(normalizedQuery, searchingForColor);
    console.log(`🔍 Local search: found ${localResults.size} results for "${normalizedQuery}"`);

    // If local search found results, use them directly
    if (localResults.size > 0) {
        applySearchResults(localResults, searchingForColor);
        if (shouldPromptSearchHydrateDetails(normalizedQuery)) {
            void refinePromptSearchWithDetails(normalizedQuery, searchingForColor, localResults, searchRequestId);
        }
        return;
    }

    if (!shouldPromptSearchHydrateDetails(normalizedQuery)) {
        triggerPromptSearchNoResultEngagement(normalizedQuery, 'local_short_query');
        applySearchResults(new Set(), searchingForColor);
        return;
    }

    await refinePromptSearchWithDetails(normalizedQuery, searchingForColor, localResults, searchRequestId);
    if (!isPromptSearchRequestCurrent(searchRequestId, normalizedQuery)) {
        return;
    }

    const hydratedResults = performLocalSearch(normalizedQuery, searchingForColor);
    if (hydratedResults.size > 0) {
        applySearchResults(hydratedResults, searchingForColor);
        return;
    }

    if (!shouldPromptSearchUseAiFallback(normalizedQuery)) {
        triggerPromptSearchNoResultEngagement(normalizedQuery, 'local_hydrated');
        applySearchResults(new Set(), searchingForColor);
        return;
    }

    // Layer 3: AI Semantic Search (only if local search failed)
    // Check rate limit for non-admin users
    if (!isAdmin && !checkAISearchRateLimit()) {
        console.log('⏳ AI search rate limited');
        showSearchCooldownMessage();
        triggerPromptSearchNoResultEngagement(normalizedQuery, 'ai_rate_limited');
        applySearchResults(new Set(), searchingForColor); // Show no results
        return;
    }

    // Trigger AI semantic search
    console.log('🔍 Local search: 0 results, triggering AI semantic search...');
    const aiResults = await performAISemanticSearch(query);
    if (!isPromptSearchRequestCurrent(searchRequestId, normalizedQuery)) {
        return;
    }

    if (aiResults.size > 0) {
        console.log(`✨ AI search: found ${aiResults.size} results`);
        applySearchResults(aiResults, searchingForColor);
    } else {
        console.log('❌ AI search: no results found');
        triggerPromptSearchNoResultEngagement(normalizedQuery, 'ai_no_result');
        applySearchResults(new Set(), searchingForColor);
    }
}

function triggerPromptSearchNoResultEngagement(query = '', source = 'prompts_search') {
    const normalizedQuery = normalizePromptSearchText(query).slice(0, 120);
    if (normalizedQuery.length < 2) return;

    const trigger = window.ZaoyoeEngagement?.trigger;
    if (typeof trigger !== 'function') return;

    try {
        void trigger('search_no_result', {
            source_module: 'prompts.search',
            source,
            source_event_id: `search_no_result:prompts:${normalizedQuery}`,
            page_id: 'prompts',
            site: window.SiteConfig?.site || 'cn',
            search_query: normalizedQuery
        }, { once: true });
    } catch (error) {
        console.debug('[PromptsSearch] Engagement no-result trigger skipped:', error?.message || error);
    }
}

function triggerPromptUnlockEngagement(triggerType = 'prompt_unlocked', promptId = '', metadata = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    const trigger = window.ZaoyoeEngagement?.trigger;
    if (typeof trigger !== 'function') return;

    const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata
        : {};
    const sourceEventId = String(source.source_event_id || '').trim()
        || `${triggerType}:prompts:${normalizedPromptId || 'unknown'}`;

    try {
        void trigger(triggerType, {
            source_module: 'prompts.unlock',
            source: String(source.source || 'prompt_unlock').trim() || 'prompt_unlock',
            source_event_id: sourceEventId,
            page_id: 'prompts',
            site: window.SiteConfig?.site || 'cn',
            prompt_id: normalizedPromptId || null,
            ...source
        }, { once: true });
    } catch (error) {
        console.debug('[PromptsUnlock] Engagement trigger skipped:', triggerType, error?.message || error);
    }
}

// Expand query using synonym dictionary
function expandSynonyms(query) {
    const q = normalizePromptSearchText(query);
    const expanded = new Set([q]);
    const isSingleCjkQuery = isPromptSearchSingleCjkTerm(q);

    for (const [key, synonyms] of Object.entries(SYNONYM_DICTIONARY)) {
        const allTerms = [key, ...synonyms].map(normalizePromptSearchText).filter(Boolean);
        const shouldExpand = isSingleCjkQuery
            ? allTerms.includes(q)
            : allTerms.some(term => q.includes(term) || term.includes(q));
        if (shouldExpand) {
            allTerms.forEach(s => expanded.add(s));
        }
    }

    return Array.from(expanded).filter(hasPromptSearchSignal);
}

// Layer 1 & 2: Local search with synonym expansion + index optimization
// 【优化】原始词做精确+部分匹配，同义词只做精确匹配
function performLocalSearch(query, searchingForColor) {
    const matchedIds = new Set();
    const originalQuery = normalizePromptSearchText(query);
    const expandedTerms = expandSynonyms(query);

    console.log(`🔄 Expanded terms: [${expandedTerms.slice(0, 5).join(', ')}${expandedTerms.length > 5 ? '...' : ''}]`);

    // Color search - still uses linear scan (color-specific)
    if (searchingForColor) {
        PROMPTS.forEach((item, index) => {
            if (item?.dominantColors?.includes(searchingForColor)) {
                matchedIds.add(index);
            }
        });
        return matchedIds;
    }

    if (!SEARCH_INDEX) buildSearchIndex();
    if (!SEARCH_INDEX) return matchedIds;

    console.log(`📊 Index size: ${Object.keys(SEARCH_INDEX).length} terms`);

    // === 策略1：原始搜索词 - 精确匹配 + 部分匹配 ===
    if (SEARCH_INDEX[originalQuery]) {
        console.log(`✅ Direct match for "${originalQuery}":`, SEARCH_INDEX[originalQuery]);
        SEARCH_INDEX[originalQuery].forEach(id => matchedIds.add(id));
    }
    // 部分匹配 - 只对原始搜索词进行
    if (shouldPromptSearchUsePartialIndexTerm(originalQuery)) {
        const partialMatches = [];
        Object.keys(SEARCH_INDEX).forEach(indexedTerm => {
            if (indexedTerm.includes(originalQuery)) {
                partialMatches.push(indexedTerm);
                SEARCH_INDEX[indexedTerm].forEach(id => matchedIds.add(id));
            }
        });
        if (partialMatches.length > 0) {
            console.log(`🔍 Partial matches for "${originalQuery}":`, partialMatches);
        }
    }

    // === 策略2：同义词 - 只做精确匹配 ===
    expandedTerms.forEach(term => {
        if (term !== originalQuery && SEARCH_INDEX[term]) {
            SEARCH_INDEX[term].forEach(id => matchedIds.add(id));
        }
    });

    // Also scan body fields so prompts whose visual words only live in descriptions still match.
    const searchableBodyTerms = expandedTerms.filter(shouldPromptSearchUseBodyTerm);
    if (searchableBodyTerms.length > 0) {
        PROMPTS.forEach((item, index) => {
            if (!item) return;
            const haystack = getPromptSearchHaystack(item);

            for (const term of searchableBodyTerms) {
                if (term && promptSearchHaystackMatchesTerm(haystack, term)) {
                    matchedIds.add(item.id ?? index);
                    break;
                }
            }
        });
    }

    return matchedIds;
}

function isPromptSearchQueryCurrent(normalizedQuery = '') {
    const searchInput = document.getElementById('gallerySearch');
    if (!searchInput) return true;
    return normalizePromptSearchText(searchInput.value) === normalizePromptSearchText(normalizedQuery);
}

function isPromptSearchRequestCurrent(searchRequestId, normalizedQuery = '') {
    return searchRequestId === PROMPT_SEARCH_REQUEST_ID && isPromptSearchQueryCurrent(normalizedQuery);
}

async function refinePromptSearchWithDetails(normalizedQuery, searchingForColor, baseResults = new Set(), searchRequestId = PROMPT_SEARCH_REQUEST_ID) {
    const detailsChanged = await hydratePromptSearchDetails();
    if (!detailsChanged || !isPromptSearchRequestCurrent(searchRequestId, normalizedQuery)) {
        return baseResults;
    }

    const refinedResults = performLocalSearch(normalizedQuery, searchingForColor);
    const combinedResults = new Set(baseResults);
    refinedResults.forEach((id) => combinedResults.add(id));

    if (combinedResults.size > baseResults.size) {
        applySearchResults(combinedResults, searchingForColor);
        return combinedResults;
    }

    return baseResults;
}

// Check AI search rate limit (returns true if allowed)
function checkAISearchRateLimit() {
    const now = Date.now();
    const windowStart = now - AI_SEARCH_RATE_LIMIT.windowMs;

    // Clean up old entries
    AI_SEARCH_RATE_LIMIT.userSearchHistory = AI_SEARCH_RATE_LIMIT.userSearchHistory.filter(
        ts => ts > windowStart
    );

    // Check if under limit
    if (AI_SEARCH_RATE_LIMIT.userSearchHistory.length >= AI_SEARCH_RATE_LIMIT.maxPerMinute) {
        return false;
    }

    // Record this search
    AI_SEARCH_RATE_LIMIT.userSearchHistory.push(now);
    AI_SEARCH_RATE_LIMIT.cooldownShown = false;
    return true;
}

// Show cooldown message
function showSearchCooldownMessage() {
    if (AI_SEARCH_RATE_LIMIT.cooldownShown) return;
    AI_SEARCH_RATE_LIMIT.cooldownShown = true;

    // Show toast or inline message
    const searchWrapper = document.querySelector('.nav-search-wrapper');
    if (searchWrapper) {
        const existingMsg = searchWrapper.querySelector('.search-cooldown-msg');
        if (existingMsg) existingMsg.remove();

        const msg = document.createElement('div');
        msg.className = 'search-cooldown-msg';
        msg.innerHTML = '<i class="fas fa-clock"></i> AI 搜索冷却中，请稍后再试';
        searchWrapper.appendChild(msg);

        setTimeout(() => msg.remove(), 3000);
    }
}

// Layer 3: AI Semantic Search using Gemini 2.0 Flash
async function performAISemanticSearch(query) {
    const matchedIds = new Set();

    // Get API key from localStorage (same as admin-studio)
    const storedKeys = localStorage.getItem('gemini_api_keys');
    let apiKey = null;

    if (storedKeys) {
        try {
            const keys = JSON.parse(storedKeys);
            const activeKey = keys.find(k => k.active);
            if (activeKey) apiKey = activeKey.key;
        } catch (e) {
            console.warn('Failed to parse stored API keys');
        }
    }

    if (!apiKey) {
        console.log('⚠️ No Gemini API key available for semantic search');
        return matchedIds;
    }

    try {
        // Build prompt for intent understanding
        const prompt = `You are a search intent analyzer for an AI art gallery.
User searched: "${query}"

Extract 5-8 specific English tags that match this search intent.
Consider: art styles, moods, subjects, colors, techniques, scenes.

Return ONLY a JSON array of lowercase tags, no explanation:
["tag1", "tag2", ...]`;

        const response = await fetch(`${GEMINI_2_0_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 256
                }
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

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
                performLocalSearch(String(tag || ''), null).forEach((id) => matchedIds.add(id));
            }
        }
    } catch (e) {
        console.error('AI semantic search error:', e);
    }

    return matchedIds;
}

// Apply search results to cards with animation
function applySearchResults(matchedIds, searchingForColor) {
    const matchedKeys = new Set();
    matchedIds.forEach((id) => {
        matchedKeys.add(id);
        matchedKeys.add(String(id));
    });

    currentFilter = 'search';
    currentPage = 1;
    allFilteredItems = PROMPTS.filter((item, index) => {
        if (!item) return;

        let isVisible = matchedKeys.has(item.id) || matchedKeys.has(String(item.id)) || matchedKeys.has(index) || matchedKeys.has(String(index));

        if (searchingForColor && !isVisible) {
            isVisible = item.dominantColors && item.dominantColors.includes(searchingForColor);
        }

        return isVisible;
    });

    renderCurrentPage();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
}

// --- Modal Logic ---
let currentModalImageIndex = 0;
let currentModalImages = [];
let isCommentMode = false;
let currentPromptId = null;
const promptModalKeyboardDock = {
    attached: false,
    onViewportChange: null,
    viewportRafId: null,
    transitionCleanupTimer: null,
    preLiftCleanupTimer: null,
    pendingUndockTimer: null,
    pendingFirstDockTimer: null,
    pendingFirstDockParams: null,
    keyboardSettleTimer: null,
    focusedReleaseTimer: null,
    pendingStableKeyboardInset: 0,
    docked: false,
    baseViewportHeight: 0,
    baseVisualHeight: 0,
    baseHeight: 0,
    baseWidth: 0,
    baseBottom: 0,
    lastStableInset: 0,
    lastKeyboardInset: 0,
    animatingUntil: 0,
    overlayBaseHeight: 0,
    preLiftActive: false,
    commentModeHeight: 0,
    commentModeGeometryLocked: false,
    commentModeGeometryTimer: null
};

let promptModalOpeningTimer = null;
let promptModalDockTimers = [];
let promptModalStatusBarShield = null;
let promptModalBaseScrollY = 0;
let promptModalCaretStabilizeTimer = null;
let promptModalStatusBarShieldTimer = null;
let promptModalThemeColorRestoreTimerId = null;
let promptModalForceHiddenTimerId = null;
let promptModalCloseCleanupTimer = null;
const PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE = 'data-prompt-modal-theme-restore';

function getPromptModalBaseScrollY() {
    return Math.max(0, Math.round(promptModalBaseScrollY || 0));
}

function scrollPromptModalPageToBase() {
    const targetY = getPromptModalBaseScrollY();
    if ((window.scrollY || window.pageYOffset || 0) !== targetY) {
        window.scrollTo(0, targetY);
    }
}

function clearPromptModalCommentGeometryTimer() {
    if (promptModalKeyboardDock.commentModeGeometryTimer) {
        clearTimeout(promptModalKeyboardDock.commentModeGeometryTimer);
        promptModalKeyboardDock.commentModeGeometryTimer = null;
    }
}

function releasePromptModalCommentModeGeometry() {
    clearPromptModalCommentGeometryTimer();
    const { modalInner } = getPromptModalDockNodes();
    modalInner?.classList.remove('prompt-comment-geometry-locked');
    setPromptsCssVars(modalInner, {
        '--prompt-modal-comment-height': null
    });
    promptModalKeyboardDock.commentModeHeight = 0;
    promptModalKeyboardDock.commentModeGeometryLocked = false;
}

function lockPromptModalCommentModeGeometry({ force = false, defer = false } = {}) {
    if (!isPromptModalMobileLayout() || !isCommentMode) return;
    const { modal, modalInner } = getPromptModalDockNodes();
    if (!modal?.classList.contains('active') || !modalInner?.classList.contains('comment-mode')) return;

    const apply = () => {
        const { modal: activeModal, modalInner: activeInner } = getPromptModalDockNodes();
        if (!activeModal?.classList.contains('active') || !activeInner?.classList.contains('comment-mode')) return;
        if (activeInner.classList.contains('keyboard-docked')) return;

        const liveHeight = Math.round(activeInner.getBoundingClientRect().height || activeInner.offsetHeight || 0);
        const nextHeight = force || !promptModalKeyboardDock.commentModeHeight
            ? liveHeight
            : promptModalKeyboardDock.commentModeHeight;
        if (nextHeight < 280) return;

        promptModalKeyboardDock.commentModeHeight = nextHeight;
        promptModalKeyboardDock.commentModeGeometryLocked = true;
        activeInner.classList.add('prompt-comment-geometry-locked');
        setPromptsCssVars(activeInner, {
            '--prompt-modal-comment-height': `${nextHeight}px`
        });
    };

    clearPromptModalCommentGeometryTimer();
    if (!defer) {
        apply();
        return;
    }

    promptModalKeyboardDock.commentModeGeometryTimer = setTimeout(() => {
        promptModalKeyboardDock.commentModeGeometryTimer = null;
        requestAnimationFrame(apply);
    }, 40);
}

function clearPromptModalTransitionCleanupTimer() {
    if (promptModalKeyboardDock.transitionCleanupTimer) {
        clearTimeout(promptModalKeyboardDock.transitionCleanupTimer);
        promptModalKeyboardDock.transitionCleanupTimer = null;
    }
}

function clearPromptModalPreLiftCleanupTimer() {
    if (promptModalKeyboardDock.preLiftCleanupTimer) {
        clearTimeout(promptModalKeyboardDock.preLiftCleanupTimer);
        promptModalKeyboardDock.preLiftCleanupTimer = null;
    }
}

function clearPromptModalLegacyDockLayout(modalInner) {
    if (!modalInner) return;
    setPromptsCssVars(modalInner, {
        position: null,
        top: null,
        left: null,
        right: null,
        bottom: null,
        margin: null,
        width: null,
        'max-width': null,
        transform: null
    });
}

function togglePromptModalSheetAnimation(modalInner, animate, duration = 250) {
    clearPromptModalTransitionCleanupTimer();
    if (!modalInner) return;

    modalInner.classList.toggle('prompt-modal-animating', !!animate);
    if (!animate) return;

    stabilizePromptModalCaretDuringMotion(duration);
    promptModalKeyboardDock.transitionCleanupTimer = setTimeout(() => {
        const { modalInner: activeInner } = getPromptModalDockNodes();
        promptModalKeyboardDock.transitionCleanupTimer = null;
        activeInner?.classList.remove('prompt-modal-animating');
        clearPromptModalCaretStabilizer(true);
    }, duration + 40);
}

function clearPromptModalCaretStabilizer(refreshCaret = false) {
    if (promptModalCaretStabilizeTimer) {
        clearTimeout(promptModalCaretStabilizeTimer);
        promptModalCaretStabilizeTimer = null;
    }

    const { modal, commentInput } = getPromptModalDockNodes();
    modal?.classList.remove('prompt-caret-stabilizing');
    if (refreshCaret) {
        refreshPromptsTextareaCaret(commentInput);
    }
}

function stabilizePromptModalCaretDuringMotion(duration = 250) {
    const { modal, commentInput } = getPromptModalDockNodes();
    if (!modal || !commentInput || document.activeElement !== commentInput) return;

    clearPromptModalCaretStabilizer(false);
    modal.classList.add('prompt-caret-stabilizing');
    promptModalCaretStabilizeTimer = setTimeout(() => {
        clearPromptModalCaretStabilizer(true);
    }, Math.max(0, duration) + 60);
}

function clearPromptModalKeyboardPreLift(restoreTransform = true) {
    const { modalInner } = getPromptModalDockNodes();
    clearPromptModalPreLiftCleanupTimer();
    promptModalKeyboardDock.preLiftActive = false;
    if (!modalInner || modalInner.classList.contains('keyboard-docked')) return;
    setPromptsCssVars(modalInner, {
        transition: null,
        'will-change': null,
        '--prompt-modal-translate-y': restoreTransform ? null : undefined,
        '--prompt-modal-scale': restoreTransform ? null : undefined
    });
}

function applyPromptModalKeyboardPreLift() {
    // Keep keyboard entrance to one visible movement: the final 250ms dock.
    clearPromptModalKeyboardPreLift(false);
}

function isPromptModalIOSMobile() {
    const ua = navigator.userAgent || '';
    const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isiOS && window.matchMedia('(max-width: 768px)').matches;
}

function isPromptModalKeyboardDockEnabled() {
    return isPromptModalIOSMobile() && !!window.visualViewport;
}

function isPromptModalMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function isPromptCommentComposerOpen() {
    const { overlay } = getPromptCommentComposerElements();
    return !!overlay?.classList.contains('active');
}

function isPromptModalExpandedCommentView() {
    const modal = document.getElementById('promptModal');
    return !!(modal?.classList.contains('active') && isCommentMode && isPromptModalMobileLayout());
}

function getCommentSortLabels() {
    const cleanTopLabel = (value, fallback) => (value || fallback).replace(/^🔥\s*/, '');
    return {
        newest: window.i18n?.t('gallery.newest') || 'Newest',
        top: cleanTopLabel(window.i18n?.t('gallery.top'), 'Top'),
        oldest: window.i18n?.t('gallery.oldest') || 'Oldest'
    };
}

function sanitizeCommentSortTopUI() {
    const currentSortLabel = document.getElementById('currentSortLabel');
    if (currentSortLabel) {
        currentSortLabel.textContent = currentSortLabel.textContent.replace(/^🔥\s*/, '');
    }

    document.querySelectorAll('.sort-option[data-sort="top"]').forEach((option) => {
        option.textContent = option.textContent.replace(/^🔥\s*/, '');
    });
}

function renderCommentEmptyState(list) {
    if (!list) return;
    const currentLang = window.i18n?.getCurrentLanguage?.() || document.documentElement.lang || 'zh';
    const title = window.i18n?.t('gallery.commentsEmpty')
        || (currentLang === 'en' ? 'No comments yet' : '暂无评论');
    const subtitle = currentLang === 'en'
        ? (window.i18n?.t('gallery.commentsEmptySub') || 'Be the first to leave a note.')
        : '';

    list.classList.add('comment-list-empty');
    list.innerHTML = `
        <div class="comment-empty-state" data-state="empty">
            <div class="comment-empty-title">${title}</div>
            ${subtitle ? `<div class="comment-empty-subtitle">${subtitle}</div>` : ''}
        </div>
    `;
}

function updateCommentSectionHeading(totalCount = null) {
    const title = document.getElementById('commentSectionTitle');
    if (!title) return;

    const explicitCount = typeof totalCount === 'number' ? totalCount : null;
    const badgeCount = parseInt(document.getElementById('commentCountBadge')?.textContent || '0', 10);
    const count = Number.isFinite(explicitCount) ? explicitCount : (Number.isFinite(badgeCount) ? badgeCount : 0);
    const currentLanguage = getCurrentLanguage();
    const isEnglish = currentLanguage === 'en';
    const commentsTitle = window.i18n?.t('gallery.commentsTitle') || (isEnglish ? 'Comments' : '评论');

    if (isPromptModalExpandedCommentView()) {
        title.textContent = count > 0
            ? (isEnglish ? `${commentsTitle} · ${count}` : `${commentsTitle} · ${count}`)
            : commentsTitle;
        return;
    }

    title.textContent = count > 0
        ? (isEnglish ? `View all ${count} comments` : `查看全部 ${count} 条评论`)
        : (window.i18n?.t('gallery.viewAllComments') || (isEnglish ? 'View all comments' : '查看全部评论'));
}

function syncPromptModalTopButtonState() {
    const button = document.getElementById('promptModalTopBtn');
    const icon = button?.querySelector('i');
    if (!button || !icon) return;

    const useBackState = isCommentMode || isPromptCommentComposerOpen();
    button.classList.toggle('is-back', useBackState);
    button.classList.toggle('is-close', !useBackState);
    button.setAttribute('aria-label', useBackState ? 'Back' : 'Close');
    icon.className = useBackState ? 'fas fa-arrow-left' : 'fas fa-times';
}

function handlePromptModalTopButton() {
    if (isPromptCommentComposerOpen()) {
        closePromptCommentComposer();
        return;
    }

    if (isCommentMode) {
        toggleCommentMode();
        return;
    }

    closePromptModal();
}

function initializePromptStaticControls() {
    if (window.__promptStaticControlsBound) return;

    document.getElementById('promptModalTopBtn')?.addEventListener('click', () => {
        handlePromptModalTopButton();
    });
    document.getElementById('modalImgNavLeft')?.addEventListener('click', () => {
        navigateModalImage('prev');
    });
    document.getElementById('modalImgNavRight')?.addEventListener('click', () => {
        navigateModalImage('next');
    });
    document.getElementById('commentTriggerBtn')?.addEventListener('click', () => {
        toggleCommentMode();
    });

    window.__promptStaticControlsBound = true;
}

function forceSafariSafeAreaJiggle() {
    // Deprecated: This caused the theme-color meta tag caching bug.
}

// Safari theme-color jiggle hack removed because it caused the status bar to turn blue permanently.
function isPromptModalThemeChromeLocked() {
    return isPromptModalIOSMobile();
}

function getPromptModalThemeColorMeta() {
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) return metaTheme;

    metaTheme = document.createElement('meta');
    metaTheme.setAttribute('name', 'theme-color');
    document.head?.appendChild(metaTheme);
    return metaTheme;
}

function getPromptModalThemeChromeMode() {
    return document.documentElement?.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function getPromptModalThemeChromeColor() {
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const currentContent = metaTheme?.getAttribute('content');
    if (currentContent) return currentContent;
    return '#000000';
}

function lockPromptModalThemeColor() {
    if (!isPromptModalThemeChromeLocked()) return;

    if (typeof window.lockSiteModalThemeColor === 'function'
        && window.lockSiteModalThemeColor({
            themeColor: getPromptModalThemeChromeColor(),
            restoreAttribute: PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE,
            restoreDelayMs: 320
        })) {
        promptModalThemeColorRestoreTimerId = null;
        return;
    }

    const metaTheme = getPromptModalThemeColorMeta();
    if (!metaTheme) return;

    if (promptModalThemeColorRestoreTimerId) {
        window.clearTimeout(promptModalThemeColorRestoreTimerId);
        promptModalThemeColorRestoreTimerId = null;
    }

    const lockedContent = metaTheme.getAttribute(PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE)
        || metaTheme.getAttribute('content')
        || getPromptModalThemeChromeColor();
    metaTheme.setAttribute(PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE, lockedContent);
    metaTheme.setAttribute('content', lockedContent);
}

function clearPromptModalThemeColor(options = {}) {
    if (!isPromptModalThemeChromeLocked()) return;

    if (promptModalThemeColorRestoreTimerId) {
        window.clearTimeout(promptModalThemeColorRestoreTimerId);
        promptModalThemeColorRestoreTimerId = null;
    }

    if (typeof window.clearSiteModalThemeColor === 'function'
        && window.clearSiteModalThemeColor({
            ...options,
            restoreAttribute: PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE,
            onRestore: () => {
                if (typeof window.__forcePromptThemeColorBlack === 'function') {
                    window.__forcePromptThemeColorBlack();
                } else if (typeof window.applySiteThemeChrome === 'function') {
                    window.applySiteThemeChrome(getPromptModalThemeChromeMode(), { forceRepaint: true });
                }
            }
        })) {
        return;
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) return;

    const restoreContent = metaTheme.getAttribute(PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE)
        || metaTheme.getAttribute('content')
        || getPromptModalThemeChromeColor();
    metaTheme.setAttribute(PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE, restoreContent);
    metaTheme.removeAttribute('content');

    const restoreDelayMs = Math.max(50, Math.trunc(Number(options.restoreDelayMs || 0) || 260));
    promptModalThemeColorRestoreTimerId = window.setTimeout(() => {
        promptModalThemeColorRestoreTimerId = null;
        if (!metaTheme.isConnected) return;
        metaTheme.setAttribute('content', restoreContent);
        metaTheme.removeAttribute(PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE);
        if (typeof window.__forcePromptThemeColorBlack === 'function') {
            window.__forcePromptThemeColorBlack();
        } else if (typeof window.applySiteThemeChrome === 'function') {
            window.applySiteThemeChrome(getPromptModalThemeChromeMode(), { forceRepaint: true });
        }
    }, restoreDelayMs);
}

function forceHidePromptModalDuringClose() {
    if (!isPromptModalThemeChromeLocked()) return;

    if (promptModalForceHiddenTimerId) {
        window.clearTimeout(promptModalForceHiddenTimerId);
        promptModalForceHiddenTimerId = null;
    }

    const { modal, backdrop } = getPromptModalDockNodes();
    document.body.classList.add('prompt-modal-force-hidden');
    modal?.classList.add('prompt-modal-force-hidden');
    backdrop?.classList.add('prompt-modal-force-hidden');

    promptModalForceHiddenTimerId = window.setTimeout(() => {
        promptModalForceHiddenTimerId = null;
        document.body.classList.remove('prompt-modal-force-hidden');
        modal?.classList.remove('prompt-modal-force-hidden');
        backdrop?.classList.remove('prompt-modal-force-hidden');
    }, 360);
}

function runPromptModalCloseChromeCleanup() {
    if (!isPromptModalThemeChromeLocked() || typeof window.runSiteModalCloseChromeCleanup !== 'function') return false;

    const { modal, backdrop } = getPromptModalDockNodes();
    return window.runSiteModalCloseChromeCleanup({
        targets: [modal, backdrop],
        bodyClass: 'prompt-modal-force-hidden',
        forceHiddenClass: 'prompt-modal-force-hidden',
        restoreAttribute: PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE,
        restoreDelayMs: 320,
        forceHiddenDurationMs: 360,
        onRestore: () => {
            if (typeof window.__forcePromptThemeColorBlack === 'function') {
                window.__forcePromptThemeColorBlack();
            } else if (typeof window.applySiteThemeChrome === 'function') {
                window.applySiteThemeChrome(getPromptModalThemeChromeMode(), { forceRepaint: true });
            }
        }
    }) === true;
}

function releasePromptModalForceHidden() {
    if (promptModalForceHiddenTimerId) {
        window.clearTimeout(promptModalForceHiddenTimerId);
        promptModalForceHiddenTimerId = null;
    }

    const { modal, backdrop } = getPromptModalDockNodes();
    document.body.classList.remove('prompt-modal-force-hidden');
    modal?.classList.remove('prompt-modal-force-hidden');
    backdrop?.classList.remove('prompt-modal-force-hidden');
}

function ensurePromptModalStatusBarShield() {
    if (promptModalStatusBarShield?.isConnected) return promptModalStatusBarShield;
    const shield = document.createElement('div');
    shield.className = 'prompt-status-bar-shield';
    document.body.appendChild(shield);
    promptModalStatusBarShield = shield;
    return shield;
}

function setPromptModalStatusBarShieldExpanded(expanded) {
    if (!isPromptModalIOSMobile()) return;
    const shield = ensurePromptModalStatusBarShield();
    if (!shield) return;
    shield.classList.toggle('prompt-status-bar-shield--expanded', Boolean(expanded));
}

function showPromptModalStatusBarShield() {
    if (!isPromptModalIOSMobile()) return;
    const shield = ensurePromptModalStatusBarShield();
    if (!shield) return;
    if (promptModalStatusBarShieldTimer) {
        clearTimeout(promptModalStatusBarShieldTimer);
        promptModalStatusBarShieldTimer = null;
    }
    setPromptModalStatusBarShieldExpanded(false);
    shield.classList.add('prompt-status-bar-shield--active');
    requestAnimationFrame(() => {
        shield.classList.add('prompt-status-bar-shield--visible');
    });
}

function hidePromptModalStatusBarShield(options = {}) {
    if (!promptModalStatusBarShield) return;
    if (promptModalStatusBarShieldTimer) {
        clearTimeout(promptModalStatusBarShieldTimer);
        promptModalStatusBarShieldTimer = null;
    }

    promptModalStatusBarShield.classList.remove('prompt-status-bar-shield--visible');
    setPromptModalStatusBarShieldExpanded(false);

    if (options.immediate) {
        promptModalStatusBarShield.classList.remove('prompt-status-bar-shield--active');
        return;
    }

    promptModalStatusBarShieldTimer = setTimeout(() => {
        promptModalStatusBarShieldTimer = null;
        if (!promptModalStatusBarShield) return;
        promptModalStatusBarShield.classList.remove('prompt-status-bar-shield--active');
    }, 90);
}

function getPromptModalDockNodes() {
    const modal = document.getElementById('promptModal');
    const modalInner = modal?.querySelector('.modal-inner');
    const commentInput = document.getElementById('commentInput');
    const backdrop = document.getElementById('promptModalBackdrop');
    return { modal, modalInner, commentInput, backdrop };
}

function ensurePromptModalBackdrop() {
    let backdrop = document.getElementById('promptModalBackdrop');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = 'promptModalBackdrop';
    backdrop.className = 'poetry-modal-backdrop';
    document.body.appendChild(backdrop);
    return backdrop;
}

function clearPromptModalOpeningTimer() {
    if (promptModalOpeningTimer) {
        clearTimeout(promptModalOpeningTimer);
        promptModalOpeningTimer = null;
    }
}

function clearPromptModalCloseCleanupTimer() {
    if (promptModalCloseCleanupTimer) {
        clearTimeout(promptModalCloseCleanupTimer);
        promptModalCloseCleanupTimer = null;
    }
}

function isPromptModalDockInputFocused() {
    const { modal } = getPromptModalDockNodes();
    const activeEl = document.activeElement;
    return !!(
        modal &&
        activeEl &&
        modal.contains(activeEl) &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)
    );
}

function isPromptModalDockContextActive() {
    const { modal, modalInner } = getPromptModalDockNodes();
    return !!(modal && modalInner && modal.classList.contains('active') && isCommentMode);
}

function clearPromptModalUndockTimer() {
    if (promptModalKeyboardDock.pendingUndockTimer) {
        clearTimeout(promptModalKeyboardDock.pendingUndockTimer);
        promptModalKeyboardDock.pendingUndockTimer = null;
    }
}

function clearPromptModalFirstDockTimer() {
    if (promptModalKeyboardDock.pendingFirstDockTimer) {
        clearTimeout(promptModalKeyboardDock.pendingFirstDockTimer);
        promptModalKeyboardDock.pendingFirstDockTimer = null;
    }
    promptModalKeyboardDock.pendingFirstDockParams = null;
}

function clearPromptModalDockTimers() {
    clearPromptModalTransitionCleanupTimer();
    clearPromptModalPreLiftCleanupTimer();
    clearPromptModalUndockTimer();
    clearPromptModalFirstDockTimer();
    clearPromptModalFocusedReleaseTimer();
    clearPromptModalCommentGeometryTimer();
    clearPromptModalCaretStabilizer(false);
}

function clearPromptModalKeyboardSettleTimer() {
    if (promptModalKeyboardDock.keyboardSettleTimer) {
        clearTimeout(promptModalKeyboardDock.keyboardSettleTimer);
        promptModalKeyboardDock.keyboardSettleTimer = null;
    }
}

function clearPromptModalFocusedReleaseTimer() {
    if (promptModalKeyboardDock.focusedReleaseTimer) {
        clearTimeout(promptModalKeyboardDock.focusedReleaseTimer);
        promptModalKeyboardDock.focusedReleaseTimer = null;
    }
}

function schedulePromptModalFocusedRelease() {
    if (promptModalKeyboardDock.focusedReleaseTimer) return;

    promptModalKeyboardDock.focusedReleaseTimer = setTimeout(() => {
        promptModalKeyboardDock.focusedReleaseTimer = null;
        if (!isPromptModalDockEnabledOrActive()) return;
        if (!promptModalKeyboardDock.docked || !isPromptModalDockInputFocused()) return;

        const liveMetrics = getPromptModalViewportMetrics();
        if (liveMetrics.bottomInset <= 40) {
            resetPromptModalKeyboardDock(true);
        }
    }, 48);
}

function schedulePromptModalStableKeyboardInset(bottomInset) {
    promptModalKeyboardDock.pendingStableKeyboardInset = bottomInset;
    clearPromptModalKeyboardSettleTimer();
    promptModalKeyboardDock.keyboardSettleTimer = setTimeout(() => {
        promptModalKeyboardDock.keyboardSettleTimer = null;
        promptModalKeyboardDock.lastStableInset = promptModalKeyboardDock.pendingStableKeyboardInset;
    }, 120);
}

function freezePromptModalOverlay() {
    const backdrop = ensurePromptModalBackdrop();
    if (!backdrop) return;

    const baseHeight = Math.max(
        promptModalKeyboardDock.overlayBaseHeight || 0,
        promptModalKeyboardDock.baseViewportHeight || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        (window.visualViewport ? ((window.visualViewport.height || 0) + (window.visualViewport.offsetTop || 0)) : 0)
    );
    promptModalKeyboardDock.overlayBaseHeight = baseHeight + 64;

    setPromptsCssVars(backdrop, {
        position: 'fixed',
        top: 'env(safe-area-inset-top, 0px)',
        left: '0',
        right: '0',
        bottom: 'auto',
        width: '100%',
        height: `${promptModalKeyboardDock.overlayBaseHeight}px`,
        'max-height': `${promptModalKeyboardDock.overlayBaseHeight}px`
    });
}

function restorePromptModalOverlay() {
    const { backdrop } = getPromptModalDockNodes();
    promptModalKeyboardDock.overlayBaseHeight = 0;

    if (!backdrop) return;
    setPromptsCssVars(backdrop, {
        position: null,
        top: null,
        left: null,
        right: null,
        bottom: null,
        width: null,
        height: null,
        'max-height': null
    });
}

function capturePromptModalDockMetrics(force = false) {
    if (!isPromptModalDockEnabledOrActive()) return;
    const { modal, modalInner } = getPromptModalDockNodes();
    const vv = window.visualViewport;
    if (!modal || !modalInner || !vv) return;
    if (modal.classList.contains('keyboard-docked')) return;

    const rect = modalInner.getBoundingClientRect();
    const viewportHeight = Math.max(
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        (vv.height || 0) + (vv.offsetTop || 0)
    );

    if (force || !promptModalKeyboardDock.docked || !promptModalKeyboardDock.baseHeight) {
        if (rect.height > 0) {
            promptModalKeyboardDock.baseHeight = Math.round(rect.height);
        }
    }

    if (force || !promptModalKeyboardDock.docked || !promptModalKeyboardDock.baseWidth) {
        if (rect.width > 0) {
            promptModalKeyboardDock.baseWidth = Math.round(rect.width);
        }
    }

    if (force || !promptModalKeyboardDock.docked || !promptModalKeyboardDock.baseBottom) {
        if (rect.bottom > 0) {
            promptModalKeyboardDock.baseBottom = Math.round(rect.bottom);
        }
    }

    if (force || !promptModalKeyboardDock.docked || !promptModalKeyboardDock.baseViewportHeight) {
        promptModalKeyboardDock.baseViewportHeight = Math.round(viewportHeight);
    }

    if (force || !promptModalKeyboardDock.docked || !promptModalKeyboardDock.baseVisualHeight) {
        promptModalKeyboardDock.baseVisualHeight = Math.round(vv.height || 0);
    }
}

function getPromptModalViewportMetrics(visualHeightOverride = null) {
    const vv = window.visualViewport;
    const visualTop = Math.max(0, vv?.offsetTop || 0);
    const visualHeight = Math.max(0, (visualHeightOverride ?? vv?.height ?? 0));
    const visualBottom = visualTop + visualHeight;
    const baseViewportHeight = Math.max(
        promptModalKeyboardDock.baseViewportHeight || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualBottom
    );
    const baseVisualHeight = Math.max(
        promptModalKeyboardDock.baseVisualHeight || 0,
        visualHeight
    );
    const bottomInset = Math.max(
        0,
        baseViewportHeight - visualBottom,
        baseVisualHeight - visualHeight
    );

    return {
        visualTop,
        visualHeight,
        visualBottom,
        baseViewportHeight,
        baseVisualHeight,
        bottomInset
    };
}

function isPromptModalDockEnabledOrActive() {
    return isPromptModalKeyboardDockEnabled() && isPromptModalDockContextActive();
}

function applyPromptModalKeyboardDock(visualHeightOverride = null, bottomInsetOverride = null, animate = false) {
    if (!isPromptModalDockEnabledOrActive()) return;
    const { modal, modalInner } = getPromptModalDockNodes();
    const vv = window.visualViewport;
    if (!modal || !modalInner || !vv) return;

    // ── Fix: Remove .modal-opening immediately to prevent CSS spring transition ──
    if (modal.classList.contains('modal-opening')) {
        clearPromptModalOpeningTimer();
        modal.classList.remove('modal-opening');
    }

    capturePromptModalDockMetrics();

    // ── CRITICAL FIX: Use window.innerHeight as the stable reference.
    // position:fixed top:50% resolves to 50% of window.innerHeight.
    // The OLD Math.max accumulator grew monotonically from transient
    // composedHeight (vv.height+vv.offsetTop) during keyboard/screenshot
    // events, permanently locking in inflated values that pushed the modal
    // off-screen. window.innerHeight is stable with interactive-widget. ──
    const viewportMetrics = getPromptModalViewportMetrics(visualHeightOverride);
    const baseViewportHeight = viewportMetrics.baseViewportHeight;
    const visualHeight = viewportMetrics.visualHeight;
    const bottomInset = Math.max(
        0,
        Math.round(bottomInsetOverride ?? viewportMetrics.bottomInset)
    );
    if (bottomInset < 60) return;

    promptModalKeyboardDock.lastStableInset = bottomInset;

    const keyboardTop = Math.max(0, baseViewportHeight - bottomInset);
    const cardHeight = Math.round(
        promptModalKeyboardDock.baseHeight || modalInner.getBoundingClientRect().height || 0
    );
    const cardWidth = Math.round(
        promptModalKeyboardDock.baseWidth || modalInner.getBoundingClientRect().width || 0
    );
    const targetBottom = Math.max(80, Math.round(keyboardTop - 8));
    const availableHeight = Math.max(200, targetBottom - 4);
    const dockHeight = Math.max(80, Math.min(cardHeight, availableHeight));
    const dockTop = Math.max(4, targetBottom - dockHeight);
    const centeredTop = (baseViewportHeight - dockHeight) / 2;
    const deltaY = Math.round(dockTop - centeredTop);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const duration = animate ? 250 : 0;

    if (promptModalKeyboardDock.docked && promptModalKeyboardDock.animatingUntil > now) {
        if (Math.abs(bottomInset - promptModalKeyboardDock.lastKeyboardInset) <= 8) {
            return;
        }
    }

    clearPromptModalUndockTimer();
    clearPromptModalFirstDockTimer();
    clearPromptModalFocusedReleaseTimer();
    clearPromptModalTransitionCleanupTimer();
    clearPromptModalKeyboardPreLift(false);
    document.body.classList.add('prompt-modal-keyboard-docked');
    scrollPromptModalPageToBase();
    modal.classList.add('keyboard-docked');
    setPromptsCssVars(modal, {
        height: `${baseViewportHeight}px`
    });
    modalInner.classList.add('keyboard-docked');
    clearPromptModalLegacyDockLayout(modalInner);
    setPromptsCssVars(modalInner, {
        '--prompt-modal-scale': '1',
        height: `${dockHeight}px`,
        'max-height': `${dockHeight}px`,
        '--prompt-modal-translate-y': `${deltaY}px`
    });
    togglePromptModalSheetAnimation(modalInner, animate, duration);
    promptModalKeyboardDock.docked = true;
    promptModalKeyboardDock.lastKeyboardInset = bottomInset;
    promptModalKeyboardDock.animatingUntil = duration ? (now + duration + 24) : 0;
}

function resetPromptModalKeyboardDock(animate = false) {
    const { modal, modalInner } = getPromptModalDockNodes();
    if (!modal || !modalInner) return;

    clearPromptModalDockTimers();
    promptModalKeyboardDock.preLiftActive = false;
    const duration = animate ? 250 : 0;
    document.body.classList.remove('prompt-modal-keyboard-docked');
    setPromptModalStatusBarShieldExpanded(false);
    clearPromptModalLegacyDockLayout(modalInner);
    setPromptsCssVars(modalInner, {
        '--prompt-modal-scale': '1',
        height: promptModalKeyboardDock.baseHeight > 0 ? `${promptModalKeyboardDock.baseHeight}px` : undefined,
        'max-height': promptModalKeyboardDock.baseHeight > 0 ? `${promptModalKeyboardDock.baseHeight}px` : undefined,
        '--prompt-modal-translate-y': '0px'
    });
    togglePromptModalSheetAnimation(modalInner, animate, duration);
    promptModalKeyboardDock.docked = false;
    promptModalKeyboardDock.animatingUntil = 0;
    promptModalKeyboardDock.lastKeyboardInset = 0;

    if (duration) {
        setTimeout(() => {
            const { modal: activeModal, modalInner: activeInner } = getPromptModalDockNodes();
            if (!activeInner || !activeModal) return;
            activeModal.classList.remove('keyboard-docked');
            setPromptsCssVars(activeModal, {
                height: null
            });
            activeInner.classList.remove('keyboard-docked');
            activeInner.classList.remove('prompt-modal-animating');
            clearPromptModalLegacyDockLayout(activeInner);
            setPromptsCssVars(activeInner, {
                height: null,
                'max-height': null,
                '--prompt-modal-translate-y': null,
                '--prompt-modal-scale': null,
                'will-change': null
            });
            requestAnimationFrame(() => capturePromptModalDockMetrics(true));
        }, duration + 40);
    } else {
        modal.classList.remove('keyboard-docked');
        setPromptsCssVars(modal, {
            height: null
        });
        modalInner.classList.remove('keyboard-docked');
        modalInner.classList.remove('prompt-modal-animating');
        clearPromptModalLegacyDockLayout(modalInner);
        setPromptsCssVars(modalInner, {
            height: null,
            'max-height': null,
            '--prompt-modal-translate-y': null,
            '--prompt-modal-scale': null,
            'will-change': null
        });
        requestAnimationFrame(() => capturePromptModalDockMetrics(true));
    }
}

function resetPromptModalKeyboardDockIfNeeded(animate = false) {
    const { modal, modalInner } = getPromptModalDockNodes();
    if (!modal || !modalInner) return;

    const hasDockState = promptModalKeyboardDock.docked ||
        modal.classList.contains('keyboard-docked') ||
        modalInner.classList.contains('keyboard-docked');

    if (!hasDockState) return;

    resetPromptModalKeyboardDock(animate);
}

function schedulePromptModalUndock() {
    if (promptModalKeyboardDock.pendingUndockTimer) return;
    promptModalKeyboardDock.pendingUndockTimer = setTimeout(() => {
        promptModalKeyboardDock.pendingUndockTimer = null;
        resetPromptModalKeyboardDock(true);
    }, 48);
}

function scheduleInitialPromptModalKeyboardDock(visualHeight, bottomInset) {
    const requiresFirstKeyboardWarmup = isPromptModalIOSMobile() && promptModalKeyboardDock.lastStableInset <= 40;
    let predictedInset = bottomInset;
    if (isPromptModalIOSMobile() && promptModalKeyboardDock.lastStableInset > 40) {
        if (bottomInset < 24) {
            predictedInset = promptModalKeyboardDock.lastStableInset;
        } else {
            predictedInset = Math.min(bottomInset, promptModalKeyboardDock.lastStableInset + 12);
        }
    }

    promptModalKeyboardDock.pendingFirstDockParams = {
        visualHeight,
        bottomInset: predictedInset,
        animate: true
    };

    if (promptModalKeyboardDock.pendingFirstDockTimer) return;

    const delay = requiresFirstKeyboardWarmup ? 96 : 40;
    promptModalKeyboardDock.pendingFirstDockTimer = setTimeout(() => {
        const params = promptModalKeyboardDock.pendingFirstDockParams;
        promptModalKeyboardDock.pendingFirstDockTimer = null;
        promptModalKeyboardDock.pendingFirstDockParams = null;

        if (!params || !isPromptModalDockEnabledOrActive() || promptModalKeyboardDock.docked) return;
        if (!isPromptModalDockInputFocused()) return;

        const settleMetrics = getPromptModalViewportMetrics(params.visualHeight);
        const settleVisualHeight = settleMetrics.visualHeight;
        const settleInsetRaw = Math.max(0, Math.round(settleMetrics.bottomInset));
        const settleInset = settleInsetRaw > 40
            ? Math.min(params.bottomInset, settleInsetRaw)
            : params.bottomInset;

        applyPromptModalKeyboardDock(settleVisualHeight, settleInset, params.animate !== false);
        if (settleInset > 40) {
            promptModalKeyboardDock.lastStableInset = settleInset;
        }
    }, delay);
}

function requestPromptModalViewportSync() {
    if (!promptModalKeyboardDock.onViewportChange) return;
    if (promptModalKeyboardDock.viewportRafId) return;

    promptModalKeyboardDock.viewportRafId = requestAnimationFrame(() => {
        promptModalKeyboardDock.viewportRafId = null;
        promptModalKeyboardDock.onViewportChange?.();
    });
}

function attachPromptModalKeyboardDock() {
    if (!isPromptModalKeyboardDockEnabled() || promptModalKeyboardDock.attached) return;
    const vv = window.visualViewport;
    if (!vv) return;

    // ── Fix: Debounce viewport changes to prevent staircase effect during keyboard rise ──
    let viewportSettleTimer = null;
    let lastViewportBottomInset = 0;

    promptModalKeyboardDock.onViewportChange = () => {
        if (!isPromptModalDockEnabledOrActive()) return;
        const inputFocused = isPromptModalDockInputFocused();
        const viewportMetrics = getPromptModalViewportMetrics();
        const visualHeight = viewportMetrics.visualHeight;
        const bottomInset = Math.max(0, Math.round(viewportMetrics.bottomInset));
        if (bottomInset < 40) {
            if (!promptModalKeyboardDock.docked) {
                capturePromptModalDockMetrics(true);
            }
            promptModalKeyboardDock.pendingStableKeyboardInset = 0;
            clearPromptModalKeyboardSettleTimer();
            if (viewportSettleTimer) { clearTimeout(viewportSettleTimer); viewportSettleTimer = null; }
        } else {
            schedulePromptModalStableKeyboardInset(bottomInset);
        }

        if (inputFocused && bottomInset > 60) {
            clearPromptModalUndockTimer();

            if (promptModalKeyboardDock.docked) {
                if (Math.abs(bottomInset - promptModalKeyboardDock.lastKeyboardInset) > 30) {
                    applyPromptModalKeyboardDock(visualHeight, bottomInset, false);
                }
                return;
            }

            // First dock: debounce to wait for keyboard to settle
            lastViewportBottomInset = bottomInset;
            if (viewportSettleTimer) clearTimeout(viewportSettleTimer);
            viewportSettleTimer = setTimeout(() => {
                viewportSettleTimer = null;
                if (!isPromptModalDockEnabledOrActive()) return;
                if (!isPromptModalDockInputFocused()) return;
                if (promptModalKeyboardDock.docked) return;
                const settleMetrics = getPromptModalViewportMetrics();
                const settleVH = settleMetrics.visualHeight;
                const settleInset = Math.max(0, Math.round(settleMetrics.bottomInset));
                if (settleInset > 60) {
                    applyPromptModalKeyboardDock(settleVH, settleInset, true);
                }
            }, 80);
            return;
        }

        if (promptModalKeyboardDock.docked && inputFocused && bottomInset <= 40) {
            clearPromptModalFirstDockTimer();
            if (viewportSettleTimer) { clearTimeout(viewportSettleTimer); viewportSettleTimer = null; }
            schedulePromptModalFocusedRelease();
            return;
        }

        if (promptModalKeyboardDock.docked && (!inputFocused || bottomInset <= 40)) {
            clearPromptModalFirstDockTimer();
            if (viewportSettleTimer) { clearTimeout(viewportSettleTimer); viewportSettleTimer = null; }
            schedulePromptModalUndock();
            return;
        }

        clearPromptModalDockTimers();
    };

    vv.addEventListener('resize', requestPromptModalViewportSync, { passive: true });
    vv.addEventListener('scroll', requestPromptModalViewportSync, { passive: true });
    window.addEventListener('resize', requestPromptModalViewportSync, { passive: true });
    window.addEventListener('orientationchange', requestPromptModalViewportSync, { passive: true });
    promptModalKeyboardDock.attached = true;
}

function detachPromptModalKeyboardDock() {
    const vv = window.visualViewport;
    if (vv && promptModalKeyboardDock.onViewportChange) {
        vv.removeEventListener('resize', requestPromptModalViewportSync);
        vv.removeEventListener('scroll', requestPromptModalViewportSync);
        window.removeEventListener('resize', requestPromptModalViewportSync);
        window.removeEventListener('orientationchange', requestPromptModalViewportSync);
    }
    if (promptModalKeyboardDock.viewportRafId) {
        cancelAnimationFrame(promptModalKeyboardDock.viewportRafId);
        promptModalKeyboardDock.viewportRafId = null;
    }
    promptModalKeyboardDock.onViewportChange = null;
    promptModalKeyboardDock.attached = false;
    promptModalKeyboardDock.baseViewportHeight = 0;
    promptModalKeyboardDock.baseVisualHeight = 0;
    promptModalKeyboardDock.baseHeight = 0;
    promptModalKeyboardDock.baseWidth = 0;
    promptModalKeyboardDock.baseBottom = 0;
    promptModalKeyboardDock.lastStableInset = 0;
    promptModalKeyboardDock.lastKeyboardInset = 0;
    promptModalKeyboardDock.pendingStableKeyboardInset = 0;
    promptModalKeyboardDock.animatingUntil = 0;
    promptModalKeyboardDock.commentModeHeight = 0;
    promptModalKeyboardDock.commentModeGeometryLocked = false;
    clearPromptModalKeyboardSettleTimer();
    clearPromptModalDockTimers();
    resetPromptModalKeyboardDock(false);
}

function primePromptModalKeyboardDock() {
    if (!isPromptModalDockEnabledOrActive()) return;
    const { modal } = getPromptModalDockNodes();
    if (modal) {
        clearPromptModalOpeningTimer();
        modal.classList.remove('modal-opening');
    }
    // Shield expansion removed — it caused visible black bar flash at status bar edge
    attachPromptModalKeyboardDock();
    capturePromptModalDockMetrics(true);
    // Undo any native Safari scroll-to-input that fired before our preventDefault
    scrollPromptModalPageToBase();
}

function getPromptDetailLoadingText() {
    return getCurrentLanguage() === 'en' ? 'Loading prompt details...' : '提示词详情加载中...';
}

function setPromptDetailLoadingState(promptText) {
    if (!promptText) return;
    promptText.classList.add('prompt-text--loading');
    promptText.setAttribute('role', 'status');
    promptText.setAttribute('aria-live', 'polite');
    promptText.setAttribute('aria-label', getPromptDetailLoadingText());
    promptText.innerHTML = `
        <span class="prompt-detail-loading-dots" aria-hidden="true">
            <span></span><span></span><span></span>
        </span>
    `;
}

function setPromptDetailTextState(promptText, text = '') {
    if (!promptText) return;
    promptText.classList.remove('prompt-text--loading');
    promptText.removeAttribute('role');
    promptText.removeAttribute('aria-live');
    promptText.removeAttribute('aria-label');
    promptText.textContent = text;
}

function setPromptModalPromptContent(promptText, item = {}) {
    if (hasPromptDetailBody(item)) {
        setPromptDetailTextState(promptText, getPromptModalPromptText(item));
        return;
    }
    setPromptDetailLoadingState(promptText);
}

function getPromptDetailUnavailableText() {
    return getCurrentLanguage() === 'en' ? 'Prompt details are temporarily unavailable.' : '提示词详情暂时不可用。';
}

function getPromptModalPromptText(item = {}) {
    if (hasPromptDetailBody(item)) {
        return getLocalizedField(item, 'prompt_text') || item.prompt || '';
    }
    return getPromptDetailLoadingText();
}

function applyPromptModalDetailContent(item = {}) {
    const title = document.getElementById('modalTitle');
    const description = document.getElementById('modalDesc');
    const promptText = document.getElementById('modalPromptText');

    if (title) {
        title.textContent = getLocalizedField(item, 'title') || item.title || '';
    }
    if (description) {
        description.textContent = getLocalizedField(item, 'description');
    }
    if (promptText) {
        setPromptDetailTextState(promptText, hasPromptDetailBody(item)
            ? getPromptModalPromptText(item)
            : getPromptDetailUnavailableText());
    }
}

function openPromptModal(id) {
    const item = PROMPTS.find(p => p.id === id);
    if (!item) return;
    const detailPromise = ensurePromptDetailLoaded(item);

    promptModalBaseScrollY = window.scrollY || window.pageYOffset || 0;

    currentPromptId = item.supabaseId || item.id; // Prefer persistent UUID if available
    const modalPromptId = String(currentPromptId || '').trim();
    console.log('[DEBUG] openPromptModal opening:', {
        localId: id,
        supabaseId: currentPromptId,
        title: item.title,
        textLength: item.prompt ? item.prompt.length : 0
    });
    trackPromptAnalyticsEvent('prompt_view', {
        entityId: String(currentPromptId || '').trim(),
        metadata: buildPromptAnalyticsMetadata(item)
    }, {
        eventType: 'engagement'
    });

    const modal = document.getElementById('promptModal');
    const modalInner = modal?.querySelector('.modal-inner');
    const backdrop = ensurePromptModalBackdrop();
    releasePromptModalForceHidden();
    clearPromptModalCloseCleanupTimer();
    lockPromptModalThemeColor();
    const vv = window.visualViewport;
    const initialViewportHeight = Math.max(
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        vv ? ((vv.height || 0) + (vv.offsetTop || 0)) : 0
    );
    promptModalKeyboardDock.baseViewportHeight = initialViewportHeight;
    promptModalKeyboardDock.baseVisualHeight = Math.max(
        promptModalKeyboardDock.baseVisualHeight || 0,
        vv?.height || 0
    );
    promptModalKeyboardDock.overlayBaseHeight = initialViewportHeight + 160;
    freezePromptModalOverlay();
    closePromptCommentComposer({ clearDraft: true });
    releasePromptModalCommentModeGeometry();

    // Reset State
    isCommentMode = false;
    modal.querySelector('.modal-inner').classList.remove('comment-mode');
    backdrop?.classList.add('visible');

    // Reset comment button state to match
    const triggerBtn = document.getElementById('commentTriggerBtn');
    if (triggerBtn) {
        triggerBtn.classList.remove('active');
        const icon = triggerBtn.querySelector('i');
        if (icon) icon.className = 'fas fa-comment-dots';
    }
    syncPromptModalTopButtonState();

    // Reset Prompt Area (in case it was docked/moved)
    const promptArea = document.getElementById('promptArea');
    const contentCol = document.querySelector('.modal-content-col');
    if (promptArea.parentNode !== contentCol) {
        // Move back to original column
        promptArea.classList.remove('docked');
        contentCol.appendChild(promptArea);
        // Correct insertion order: before comment section
        const commentSection = document.getElementById('commentSection');
        contentCol.insertBefore(promptArea, commentSection);
    }

    // Reset Unlock State
    const unlockBtn = document.getElementById('unlockPromptBtn');
    const promptText = document.getElementById('modalPromptText');
    promptText.classList.add('blur-masked');
    unlockBtn.innerHTML = `<i class="fas fa-gem"></i> ${_unlockPrice}`;
    unlockBtn.className = 'unlock-btn';
    unlockBtn.disabled = false;
    unlockBtn.onclick = handleUnlockPrompt;

    // Reset unlock lock for new prompt
    _unlockInProgress = false;

    // Reset copy lock for new prompt
    _copyInProgress = false;

    // Store images for navigation
    currentModalImages = getPromptImageAssets(item)
        .map(getPromptModalImageUrl)
        .filter(Boolean);
    currentModalImageIndex = 0;

    // Reset Image Container - remove ALL images (including leftovers from transitions)
    const imgContainer = document.querySelector('.modal-image-col');
    const allImages = imgContainer.querySelectorAll('img');
    allImages.forEach(img => img.remove());

    // Reset animation lock
    isModalImageAnimating = false;

    // Create fresh image
    const newImg = document.createElement('img');
    newImg.id = 'modalImg';
    newImg.className = 'active';
    newImg.src = currentModalImages[0] || '';
    newImg.alt = getLocalizedField(item, 'title');

    // Insert before nav buttons
    const firstBtn = imgContainer.querySelector('.modal-img-nav');
    imgContainer.insertBefore(newImg, firstBtn);

    // Populate Data (with i18n support)
    document.getElementById('modalTitle').textContent = getLocalizedField(item, 'title');
    document.getElementById('modalDesc').textContent = getLocalizedField(item, 'description');

    // Set prompt text (ensure clean connection) - use localized version if available
    setPromptModalPromptContent(promptText, item);
    detailPromise
        .then((updatedItem) => {
            if (String(currentPromptId || '').trim() !== modalPromptId) return;
            applyPromptModalDetailContent(updatedItem);
        })
        .catch((error) => {
            console.warn('Failed to load prompt detail:', error?.message || error);
            if (String(currentPromptId || '').trim() === modalPromptId) {
                setPromptDetailTextState(promptText, getPromptDetailUnavailableText());
            }
        });

    // Tags hidden as per user request
    const tagsContainer = document.getElementById('modalTags');
    tagsContainer.innerHTML = ''; // Hidden

    // Show/hide navigation arrows and counter
    const hasMultipleImages = currentModalImages.length > 1;
    const leftArrow = document.getElementById('modalImgNavLeft');
    const rightArrow = document.getElementById('modalImgNavRight');
    const counter = document.getElementById('modalImgCounter');

    if (hasMultipleImages) {
        leftArrow.classList.add('is-visible');
        rightArrow.classList.add('is-visible');
        counter.classList.add('is-visible');
        updateModalCounter();
    } else {
        leftArrow.classList.remove('is-visible');
        rightArrow.classList.remove('is-visible');
        counter.classList.remove('is-visible');
    }

    // Reset Comments
    const commentList = document.getElementById('commentList');
    if (commentList) {
        commentList.classList.remove('comment-list-empty');
        commentList.innerHTML = '';
    }
    applyPromptCommentCount(currentPromptId, getCachedPromptCommentCount(currentPromptId));

    // Check unlock status (if logged in)
    checkUnlockStatus(currentPromptId);

    // Fetch comment count
    void preloadPromptCommentCounts();
    void fetchCommentCount(currentPromptId);
    void prefetchComments(currentPromptId);

    // Initialize image upload functionality
    initCommentImageUpload();

    // Physical modal mounting
    document.body.classList.add('modal-open');

    modal.classList.add('poetry-modal--visible');
    // Clear any stale closing state (clip-path, etc.) from previous close
    modal.classList.remove('closing');
    if (backdrop) backdrop.classList.remove('closing');
    void modal.offsetWidth; // Force reflow to guarantee CSS transition plays safely

    modal.classList.add('active');
    modal.classList.add('modal-opening');
    if (window.iOSScrollLock && modalInner) {
        window.iOSScrollLock.lockLight(modalInner);
    }
    // Manually add overflow:hidden to html/body on iOS.
    // lockLight skips this to avoid "black block" issue, but we need it
    // to prevent Safari's native scroll-to-input from pushing the page.
    // Unlike full lock(), this does NOT set position:fixed on body,
    // so Safari's bottom bar keeps sampling black background (not canvas blue).
    if (isPromptModalIOSMobile()) {
        setPromptsPageOverflow('hidden');
    }

    showPromptModalStatusBarShield();
    resetPromptModalKeyboardDock(false);
    clearPromptModalOpeningTimer();
    promptModalOpeningTimer = setTimeout(() => {
        modal.classList.remove('modal-opening');
        promptModalOpeningTimer = null;
    }, 650);
    if (isPromptModalKeyboardDockEnabled()) {
        requestAnimationFrame(() => {
            if (!modal.classList.contains('active')) return;
            capturePromptModalDockMetrics(true);
        });
    }
}

// --- Spatial Flow & Comment Logic ---

function toggleCommentMode() {
    const modalInner = document.querySelector('.modal-inner');
    const promptArea = document.getElementById('promptArea');
    const dockTarget = document.getElementById('promptDockTarget');
    const contentCol = document.querySelector('.modal-content-col');
    const isMobileLayout = isPromptModalMobileLayout();


    if (isCommentMode) {
        // CLOSE COMMENTS (Revert to default)
        isCommentMode = false;
        setCommentSortDropdownOpen(false);
        closePromptCommentComposer({ preserveModalDock: true });
        releasePromptModalCommentModeGeometry();
        modalInner.classList.remove('comment-mode');
        resetPromptModalKeyboardDockIfNeeded(false);

        // Update toggle button - revert to comment icon
        const triggerBtn = document.getElementById('commentTriggerBtn');
        if (triggerBtn) {
            triggerBtn.classList.remove('active');
            triggerBtn.querySelector('i').className = 'fas fa-comment-dots';
        }
        updateCommentSectionHeading();
        syncPromptModalTopButtonState();

        if (!isMobileLayout) {
            // FLIP: Move Prompt back to Right Column
            promptArea.classList.remove('docked');
            const commentSection = document.getElementById('commentSection');
            contentCol.insertBefore(promptArea, commentSection);

            promptArea.classList.remove('returning');
            void promptArea.offsetWidth;
            promptArea.classList.add('returning');

            const img = document.querySelector('.modal-image-col img');
            if (img) img.classList.add('blur-motion');

            setTimeout(() => {
                promptArea.classList.remove('returning');
                if (img) img.classList.remove('blur-motion');
            }, 500);
        }

    } else {
        // OPEN COMMENTS (Activate Spatial Flow)
        isCommentMode = true;
        setCommentSortDropdownOpen(false);
        modalInner.classList.add('comment-mode');
        lockPromptModalCommentModeGeometry({ force: true, defer: true });

        // Update toggle button - change to close icon
        const triggerBtn = document.getElementById('commentTriggerBtn');
        if (triggerBtn) {
            triggerBtn.classList.add('active');
            triggerBtn.querySelector('i').className = 'fas fa-comment-dots';
        }
        updateCommentSectionHeading();
        syncPromptModalTopButtonState();

        // Fetch comments


        fetchComments(currentPromptId);

        if (!isMobileLayout) {
            const first = promptArea.getBoundingClientRect();
            dockTarget.appendChild(promptArea);
            promptArea.classList.add('docked');

            const last = promptArea.getBoundingClientRect();

            const dx = first.left - last.left;
            const dy = first.top - last.top;
            const wRatio = first.width / last.width;

            setPromptsCssVars(promptArea, {
                transform: `translate(${dx}px, ${dy}px) scale(${wRatio})`,
                'transform-origin': 'top left'
            });

            requestAnimationFrame(() => {
                setPromptsCssVars(promptArea, {
                    transition: 'transform 0.5s ease-in-out',
                    transform: null
                });

                const img = document.querySelector('.modal-image-col img');
                if (img) img.classList.add('blur-motion');

                setTimeout(() => {
                    setPromptsCssVars(promptArea, {
                        transition: null
                    });
                    if (img) img.classList.remove('blur-motion');
                }, 500);
            });
        }

        if (isPromptModalKeyboardDockEnabled()) {
            requestAnimationFrame(() => capturePromptModalDockMetrics(true));
        }
    }
}

// --- Unlock & Points Logic ---

async function checkUnlockStatus(promptId) {
    if (!window.supabaseClient) return;
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) return; // Not logged in

    try {
        // Check if unlocked in DB
        const { data, error } = await window.supabaseClient
            .from('prompt_unlocks')
            .select('id')
            .eq('user_id', user.id)
            .eq('prompt_id', promptId)
            .eq('site', window.SiteConfig?.site || 'cn')
            .maybeSingle();

        if (data) {
            setPromptUnlocked();
        }
    } catch (err) {
        console.error("Unlock check failed", err);
    }
}

// ============================================
// UNLOCK PROMPT V2 - 完全重写
// ============================================
let _unlockInProgress = false;
let _unlockPrice = 1; // 默认值，将从配置加载
let _copyInProgress = false; // 防止重复复制操作

function findPromptAnalyticsItem(promptId = currentPromptId) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) return null;

    return PROMPTS.find((prompt) => (
        String(prompt?.supabaseId || '').trim() === normalizedPromptId
        || String(prompt?.id || '').trim() === normalizedPromptId
    )) || null;
}

function buildPromptAnalyticsMetadata(promptItem = null) {
    const item = promptItem || findPromptAnalyticsItem();
    const localizedTitle = item ? String(getLocalizedField(item, 'title') || item.title || '').trim() : '';
    const category = item?.category
        || item?.prompt_type
        || (Array.isArray(item?.aiTags) && item.aiTags.length > 0 ? item.aiTags[0] : '')
        || '';

    return {
        prompt_id: String(item?.supabaseId || item?.id || currentPromptId || '').trim() || null,
        local_prompt_id: item?.id ?? null,
        category: String(category || '').trim() || null,
        title: localizedTitle || null
    };
}

function trackPromptAnalyticsEvent(eventName, payload = {}, options = {}) {
    const tracker = window.UserEventTracker;
    if (!tracker || typeof tracker.track !== 'function') {
        return;
    }

    const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};
    const normalizedPayload = {
        module: payload.module || 'prompt_gallery',
        entityType: payload.entityType || 'prompt',
        entityId: payload.entityId || String(currentPromptId || '').trim() || null,
        eventValue: payload.eventValue ?? null,
        pointsDelta: payload.pointsDelta ?? null,
        metadata
    };

    const trackingPromise = options.dedupeKey && typeof tracker.trackOnce === 'function'
        ? tracker.trackOnce(options.dedupeKey, eventName, normalizedPayload, { eventType: options.eventType || 'engagement' })
        : tracker.track(eventName, normalizedPayload, { eventType: options.eventType || 'engagement' });

    void Promise.resolve(trackingPromise).catch((error) => {
        console.debug('[PromptAnalytics] Track failed:', eventName, error?.message || error);
    });
}

// 从数据库加载解锁价格配置
async function loadUnlockPrice() {
    try {
        if (!window.supabaseClient) return;
        const { data, error } = await window.supabaseClient
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'unlock_pricing')
            .single();
        if (!error && data?.config_value?.default_points) {
            _unlockPrice = data.config_value.default_points;
            console.log('[Unlock] Price loaded from config:', _unlockPrice);
        }
    } catch (err) {
        console.warn('[Unlock] Failed to load price config, using default:', err.message);
    }
}

// 页面加载时预加载价格
loadUnlockPrice();

async function openPromptUnlockRecharge(context = {}) {
    const loader = window.ZaoyoeWalletModalBootstrap;
    if (loader?.open) {
        try {
            await loader.open('recharge', context);
            return true;
        } catch (error) {
            console.warn('[Unlock] Failed to lazy load wallet modal:', error?.message || error);
        }
    }

    if (typeof WalletModal !== 'undefined' && WalletModal.open) {
        WalletModal.open('recharge', context);
        return true;
    }

    if (window.WalletModal && window.WalletModal.open) {
        window.WalletModal.open('recharge', context);
        return true;
    }

    return false;
}

async function handleUnlockPrompt() {
    // 单一全局锁
    if (_unlockInProgress) {
        console.log('[Unlock] Already in progress, skipping');
        return;
    }
    _unlockInProgress = true;

    const btn = document.getElementById('unlockPromptBtn');
    const originalHTML = btn?.innerHTML || `<i class="fas fa-gem"></i> ${_unlockPrice}`;
    const promptMetadata = buildPromptAnalyticsMetadata();

    try {
        // 立即禁用按钮
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        // 检查登录
        if (!window.supabaseClient) {
            alert('数据库未连接');
            return;
        }

        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) {
            showLoginModal();
            return;
        }

        trackPromptAnalyticsEvent('unlock_click', {
            entityId: String(currentPromptId || '').trim(),
            eventValue: _unlockPrice,
            metadata: {
                ...promptMetadata,
                price: _unlockPrice
            }
        }, {
            eventType: 'conversion'
        });

        // 调用新的 V2 RPC
        console.log('[Unlock] Calling unlock_prompt_v2 for prompt:', currentPromptId);
        const { data, error } = await window.supabaseClient
            .rpc('unlock_prompt_v2', {
                p_prompt_id: String(currentPromptId),
                p_cost: _unlockPrice,
                p_site: window.SiteConfig?.site || 'cn'
            });

        console.log('[Unlock] RPC result:', data, error);

        if (error) {
            throw new Error(error.message);
        }

        if (data?.success) {
            if (data.already_unlocked) {
                console.log('[Unlock] Already unlocked, just showing');
            } else {
                trackPromptAnalyticsEvent('unlock_success', {
                    entityId: String(currentPromptId || '').trim(),
                    eventValue: _unlockPrice,
                    pointsDelta: -Math.abs(Number(_unlockPrice) || 0),
                    metadata: {
                        ...promptMetadata,
                        points_spent: _unlockPrice
                    }
                }, {
                    eventType: 'conversion'
                });
                triggerPromptUnlockEngagement('prompt_unlocked', currentPromptId, {
                    source: 'unlock_success',
                    source_event_id: `prompt_unlocked:prompts:${String(currentPromptId || '').trim() || 'unknown'}`,
                    category: promptMetadata.category || null,
                    points_cost: _unlockPrice,
                    new_balance: data.new_balance ?? null
                });
            }
            setPromptUnlocked();
            console.log('[Unlock] Success! New Balance:', data.new_balance);
        } else {
            const errMsg = data?.error || '解锁失败';
            const hasInsufficientPoints = errMsg.includes('积分不足') || errMsg.includes('Insufficient');
            // If insufficient points, open wallet modal for recharging
            if (hasInsufficientPoints) {
                triggerPromptUnlockEngagement('points_insufficient', currentPromptId, {
                    source: 'unlock_insufficient_points',
                    source_event_id: `points_insufficient:prompts:${String(currentPromptId || '').trim() || 'unknown'}:${Date.now()}`,
                    category: promptMetadata.category || null,
                    points_cost: _unlockPrice,
                    error_message: errMsg
                });
            }
            alert(errMsg);
            if (hasInsufficientPoints) {
                await openPromptUnlockRecharge({
                    entry: 'unlock_insufficient_points',
                    sourceModule: 'prompt_gallery',
                    promptId: String(currentPromptId || '').trim(),
                    category: promptMetadata.category || null
                });
            }
            if (btn) {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }
        }
    } catch (err) {
        console.error('[Unlock] Error:', err);
        alert('解锁失败: ' + err.message);
        if (btn) {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }
    } finally {
        _unlockInProgress = false;
    }
}

function setPromptUnlocked() {
    const promptText = document.getElementById('modalPromptText');
    const unlockBtn = document.getElementById('unlockPromptBtn');

    // Remove blur
    promptText.classList.remove('blur-masked');

    // 🔓 SECURITY FIX: Inject real text now (with i18n support)
    const promptId = currentPromptId; // Global variable set in openPromptModal
    // Find prompt in PROMPTS (supabaseId or id match)
    const promptItem = PROMPTS.find(p => p.supabaseId === promptId || p.id === promptId);
    if (promptItem) {
        if (hasPromptDetailBody(promptItem)) {
            setPromptDetailTextState(promptText, getPromptModalPromptText(promptItem));
        } else {
            setPromptDetailLoadingState(promptText);
            ensurePromptDetailLoaded(promptItem)
                .then((updatedItem) => {
                    if (currentPromptId !== promptId) return;
                    setPromptDetailTextState(promptText, hasPromptDetailBody(updatedItem)
                        ? getPromptModalPromptText(updatedItem)
                        : getPromptDetailUnavailableText());
                })
                .catch((error) => {
                    console.warn('Failed to load unlocked prompt detail:', error?.message || error);
                    if (currentPromptId === promptId) {
                        setPromptDetailTextState(promptText, getPromptDetailUnavailableText());
                    }
                });
        }
    }

    // Reset copy lock when unlocking (in case it's stuck)
    _copyInProgress = false;
    console.log('[Copy] Reset lock in setPromptUnlocked, _copyInProgress:', _copyInProgress);

    // Transform button to Copy
    unlockBtn.innerHTML = '<i class="fas fa-copy"></i>';
    unlockBtn.className = 'copy-btn'; // Switch to simple style
    unlockBtn.disabled = false; // Re-enable button (it was disabled during unlock)

    // Clear any existing onclick handler and set new one
    unlockBtn.onclick = null;
    unlockBtn.onclick = function () {
        console.log('[Copy] Button clicked, _copyInProgress:', _copyInProgress);
        copyPromptText(this);
    };

    console.log('[Copy] Button setup complete, disabled:', unlockBtn.disabled);
}

function copyPromptText(btn) {
    // Prevent multiple simultaneous copy operations
    if (_copyInProgress) {
        console.log('[Copy] Already copying, skipping');
        return;
    }

    _copyInProgress = true;
    const text = document.getElementById('modalPromptText').textContent;

    navigator.clipboard.writeText(text).then(() => {
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.classList.add('copied');

        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.classList.remove('copied');
            _copyInProgress = false;
        }, 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        _copyInProgress = false;
    });
}


// --- Comment System (Supabase) ---

// ===========================================
// TIME FORMATTING FOR COMMENTS
// ===========================================

/**
 * Format comment time with relative display
 * @param {string} timestamp - ISO timestamp from database
 * @returns {string} Formatted time string
 */
function formatCommentTime(timestamp) {
    const now = dayjs();
    const time = dayjs(timestamp);
    const diffHours = now.diff(time, 'hour');

    if (diffHours < 24) {
        // Within 24 hours: Use relative time ("2 minutes ago", "3 hours ago")
        return time.fromNow();
    } else if (diffHours < 168) {
        // Within 7 days: Show weekday + time ("Monday 14:30")
        return time.format('dddd HH:mm');
    } else {
        // Older than 7 days: Show date ("2025-12-20")
        return time.format('YYYY-MM-DD');
    }
}

// ===========================================
// IMAGE ATTACHMENTS FOR COMMENTS
// ===========================================

// Global state for selected image
let selectedCommentImage = null;
let promptCommentComposerMounted = false;
let promptCommentComposerViewportCleanup = null;
let promptCommentComposerBaseViewportHeight = 0;
let promptCommentComposerBaseVisualHeight = 0;
let promptCommentComposerViewportRafId = null;
let promptCommentComposerStableViewportProbe = null;
let promptCommentComposerSettleSyncTimers = [];
let promptCommentComposerLastBottomInset = 0;
let promptCommentComposerInsetDropTimer = null;
let promptCommentComposerPendingInset = 0;
let promptCommentComposerDocked = false;
let promptCommentComposerBlurUndocking = false;
let promptCommentComposerFocusedReleaseTimer = null;
let promptCommentComposerInitialDockTimer = null;
let promptCommentComposerBaseSheetHeight = 0;
let promptCommentComposerOwnsScrollLock = false;
let promptCommentComposerScrollLockMode = null;
let promptCommentComposerScrollClampCleanup = null;
let promptCommentComposerAuthAlertTimer = null;
let promptCommentComposerLoginModalTimer = null;
let promptCommentComposerCaretStabilizeTimer = null;
let promptCommentComposerEnterAnimationTimer = null;
const PROMPT_COMMENT_COMPOSER_KEYBOARD_CLEARANCE = 12;
const PROMPT_COMMENT_COMPOSER_AUTH_ALERT_DURATION_MS = 1080;
const PROMPT_COMMENT_COMPOSER_ENTER_ANIMATION_MS = 420;

function isPromptCommentComposerEnabled() {
    return isPromptModalIOSMobile();
}

function getPromptCommentComposerElements() {
    return {
        overlay: document.getElementById('promptCommentComposer'),
        sheet: document.querySelector('#promptCommentComposer .prompt-comment-composer-sheet'),
        editor: document.querySelector('#promptCommentComposer .prompt-comment-composer-editor'),
        input: document.getElementById('promptCommentComposerInput'),
        meta: document.getElementById('promptCommentComposerMeta'),
        uploadBtn: document.getElementById('promptCommentComposerUploadBtn'),
        fileInput: document.getElementById('promptCommentComposerImageUpload'),
        sendBtn: document.getElementById('promptCommentComposerSendBtn')
    };
}

function autoExpandPromptCommentComposerInput(input) {
    if (!input) return;
    if (!input.value.trim()) {
        resetPromptsTextareaAutoHeight(input);
        return;
    }
    const maxHeight = Math.min(Math.round((window.innerHeight || 0) * 0.42), 360);
    applyPromptsTextareaAutoHeight(input, maxHeight || 360, 160);
}

function syncPromptCommentComposerEmptyState() {
    const { editor, input } = getPromptCommentComposerElements();
    if (!editor || !input) return;
    const isEmpty = !input.value.trim();

    editor.classList.toggle('is-empty', isEmpty);
    input.classList.toggle('is-empty', isEmpty);
}

function focusPromptCommentComposerInputWithoutScroll(input) {
    if (!input) return;
    try {
        input.focus({ preventScroll: true });
    } catch (_) {
        input.focus();
    }
}

function bindPromptCommentComposerInputFocusStabilizer(input) {
    if (!input || input.dataset.preventScrollBind === '1') return;

    input.addEventListener('touchstart', (e) => {
        if (!isPromptCommentComposerEnabled()) return;
        if (e.cancelable) e.preventDefault();
        capturePromptCommentComposerViewportBase();
        lockPromptCommentComposerPage();
        focusPromptCommentComposerInputWithoutScroll(input);
        schedulePromptCommentComposerSettleSync();
    }, { passive: false });

    input.dataset.preventScrollBind = '1';
}

function getPromptCommentComposerI18n() {
    return {
        commentsTitle: window.i18n?.t('gallery.commentsTitle') || 'Comments',
        title: window.i18n?.t('gallery.commentComposerTitle') || 'Leave a note',
        placeholder: window.i18n?.t('gallery.commentComposerPlaceholder') || 'Start writing here...',
        attachImage: window.i18n?.t('gallery.attachImage') || 'Attach image',
        imageAttached: window.i18n?.t('gallery.imageAttached') || 'Image attached',
        imageSelected: window.i18n?.t('gallery.imageSelected') || 'Image selected',
        imageSelectedLabel: window.i18n?.t('gallery.imageSelectedLabel') || 'Selected',
        imageCompressedLabel: window.i18n?.t('gallery.imageCompressedLabel') || 'Compressed',
        tapToRemove: window.i18n?.t('gallery.tapToRemove') || 'tap to remove',
        send: window.i18n?.t('gallery.send') || 'Send',
        close: window.i18n?.t('common.close') || 'Close',
        removeSelectedImageConfirm: window.i18n?.t('gallery.removeSelectedImageConfirm') || 'Remove selected image?',
        selectImageFileError: window.i18n?.t('gallery.selectImageFileError') || 'Please select an image file',
        compressingImage: window.i18n?.t('gallery.compressingImage') || 'Compressing image...',
        imageCompressFailed: window.i18n?.t('gallery.imageCompressFailed') || 'Image compression failed, please try again'
    };
}

function buildCommentImageUploadTitle(file, finalFile, compressed) {
    const copy = getPromptCommentComposerI18n();
    const originalSize = (file.size / 1024).toFixed(0);
    const compressedSize = (finalFile.size / 1024).toFixed(0);

    if (compressed === file) {
        return `${copy.imageSelectedLabel}: ${file.name} (${originalSize}KB)`;
    }

    return `${copy.imageCompressedLabel}: ${file.name} (${originalSize}KB -> ${compressedSize}KB, ${copy.tapToRemove})`;
}

function refreshCommentImageUploadLanguageUI() {
    const copy = getPromptCommentComposerI18n();
    const bindings = getCommentImageUploadBindings();
    bindings.forEach(({ button }) => {
        const title = selectedCommentImage ? copy.imageSelected : copy.attachImage;
        button.dataset.defaultTitle = copy.attachImage;
        button.title = title;
        button.setAttribute('aria-label', title);
    });
}

function syncPromptCommentComposerMeta() {
    const { input, meta } = getPromptCommentComposerElements();
    if (!input || !meta) return;

    const copy = getPromptCommentComposerI18n();
    const pieces = [];
    const replyToName = input.dataset.replyToName;
    if (replyToName) {
        pieces.push(`${window.i18n?.t('gallery.replyingTo') || 'Replying to'} @${replyToName}`);
    }
    if (selectedCommentImage) {
        pieces.push(copy.imageAttached);
    }

    meta.textContent = pieces.join(' · ');
    meta.classList.toggle('has-reply', !!replyToName);
}

function flashPromptCommentComposerAuthRequired() {
    const { overlay } = getPromptCommentComposerElements();
    if (!overlay || !overlay.classList.contains('active')) return false;

    overlay.classList.remove('auth-required');
    void overlay.offsetWidth;
    overlay.classList.add('auth-required');

    if (promptCommentComposerAuthAlertTimer) {
        clearTimeout(promptCommentComposerAuthAlertTimer);
    }

    promptCommentComposerAuthAlertTimer = setTimeout(() => {
        overlay.classList.remove('auth-required');
        promptCommentComposerAuthAlertTimer = null;
    }, PROMPT_COMMENT_COMPOSER_AUTH_ALERT_DURATION_MS);

    return true;
}

function queuePromptCommentComposerLoginModal(delayMs = 0) {
    if (promptCommentComposerLoginModalTimer) {
        clearTimeout(promptCommentComposerLoginModalTimer);
    }

    promptCommentComposerLoginModalTimer = setTimeout(() => {
        promptCommentComposerLoginModalTimer = null;
        showLoginModal();
    }, Math.max(0, delayMs));
}

function updatePromptCommentComposerTriggerState() {
    const triggerInput = document.getElementById('commentInput');
    const triggerArea = triggerInput?.closest('.comment-input-area');
    const proxyLabel = document.getElementById('commentInputProxyLabel');
    if (!triggerInput || !triggerArea) return;

    const hasDraft = Boolean(triggerInput.value.trim());
    triggerArea.classList.toggle('has-draft', hasDraft);

    if (proxyLabel) {
        proxyLabel.textContent = window.i18n?.t('gallery.commentsTitle') || '评论';
    }
}

function syncPromptCommentComposerTrigger() {
    const triggerInput = document.getElementById('commentInput');
    const { input } = getPromptCommentComposerElements();
    if (!triggerInput || !input) return;

    triggerInput.value = input.value;
    if (input.dataset.replyTo) {
        triggerInput.dataset.replyTo = input.dataset.replyTo;
    } else {
        delete triggerInput.dataset.replyTo;
    }
    if (input.dataset.replyToName) {
        triggerInput.dataset.replyToName = input.dataset.replyToName;
    } else {
        delete triggerInput.dataset.replyToName;
    }
    autoExpandTextarea(triggerInput);
    updatePromptCommentComposerTriggerState();
}

function clearCommentDraftFields() {
    const triggerInput = document.getElementById('commentInput');
    const { input } = getPromptCommentComposerElements();

    if (triggerInput) {
        triggerInput.value = '';
        delete triggerInput.dataset.replyTo;
        delete triggerInput.dataset.replyToName;
        resetPromptsTextareaAutoHeight(triggerInput);
    }

    if (input) {
        input.value = '';
        delete input.dataset.replyTo;
        delete input.dataset.replyToName;
        resetPromptsTextareaAutoHeight(input);
    }

    syncPromptCommentComposerMeta();
    updatePromptCommentComposerTriggerState();
}

function detachPromptCommentComposerViewportSync() {
    if (typeof promptCommentComposerViewportCleanup === 'function') {
        promptCommentComposerViewportCleanup();
        promptCommentComposerViewportCleanup = null;
    }
    clearPromptCommentComposerSettleSyncTimers();
    if (promptCommentComposerInitialDockTimer) {
        clearTimeout(promptCommentComposerInitialDockTimer);
        promptCommentComposerInitialDockTimer = null;
    }
    if (promptCommentComposerInsetDropTimer) {
        clearTimeout(promptCommentComposerInsetDropTimer);
        promptCommentComposerInsetDropTimer = null;
    }
    clearPromptCommentComposerFocusedReleaseTimer();
    promptCommentComposerPendingInset = 0;
}

function unlockPromptCommentComposerPage() {
    if (typeof promptCommentComposerScrollClampCleanup === 'function') {
        promptCommentComposerScrollClampCleanup();
        promptCommentComposerScrollClampCleanup = null;
    }
    if (promptCommentComposerOwnsScrollLock && window.iOSScrollLock) {
        const modalInner = document.querySelector('#promptModal .modal-inner');
        const modal = document.getElementById('promptModal');
        const canTransferLightLock = promptCommentComposerScrollLockMode === 'light' &&
            modal?.classList.contains('active') &&
            modalInner;
        if (canTransferLightLock) {
            scrollPromptModalPageToBase();
            window.iOSScrollLock.lockLight(modalInner, { restoreScrollDuringViewport: true });
        } else {
            window.iOSScrollLock.unlock();
            scrollPromptModalPageToBase();
            if (modal?.classList.contains('active') && modalInner) {
                window.iOSScrollLock.lockLight(modalInner, { restoreScrollDuringViewport: true });
            }
        }
    }
    promptCommentComposerOwnsScrollLock = false;
    promptCommentComposerScrollLockMode = null;
}

function lockPromptCommentComposerPage() {
    const { overlay } = getPromptCommentComposerElements();
    const sheet = overlay?.querySelector('.prompt-comment-composer-sheet');
    if (window.iOSScrollLock && sheet) {
        window.iOSScrollLock.lockLight(sheet, { restoreScrollDuringViewport: true });
        promptCommentComposerOwnsScrollLock = true;
        promptCommentComposerScrollLockMode = 'light';
    }
}

function getPromptCommentComposerStableViewportProbe() {
    if (promptCommentComposerStableViewportProbe?.isConnected) {
        return promptCommentComposerStableViewportProbe;
    }

    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.className = 'prompt-comment-composer-viewport-probe';
    document.body.appendChild(probe);
    promptCommentComposerStableViewportProbe = probe;
    return probe;
}

function getPromptCommentComposerStableViewportHeight() {
    const probe = getPromptCommentComposerStableViewportProbe();
    return Math.max(0, Math.round(probe?.getBoundingClientRect().height || probe?.offsetHeight || 0));
}

function clearPromptCommentComposerCaretStabilizer(refreshCaret = false) {
    if (promptCommentComposerCaretStabilizeTimer) {
        clearTimeout(promptCommentComposerCaretStabilizeTimer);
        promptCommentComposerCaretStabilizeTimer = null;
    }

    const { overlay, input } = getPromptCommentComposerElements();
    overlay?.classList.remove('composer-caret-stabilizing');
    if (refreshCaret) {
        refreshPromptsTextareaCaret(input);
    }
}

function clearPromptCommentComposerEnterAnimation(removeClass = false) {
    if (promptCommentComposerEnterAnimationTimer) {
        clearTimeout(promptCommentComposerEnterAnimationTimer);
        promptCommentComposerEnterAnimationTimer = null;
    }

    if (removeClass) {
        const { overlay } = getPromptCommentComposerElements();
        overlay?.classList.remove('composer-entering');
    }
}

function startPromptCommentComposerEnterAnimation(overlay) {
    if (!overlay) return;
    clearPromptCommentComposerEnterAnimation(false);
    overlay.classList.add('composer-entering');
    promptCommentComposerEnterAnimationTimer = setTimeout(() => {
        overlay.classList.remove('composer-entering');
        promptCommentComposerEnterAnimationTimer = null;
    }, PROMPT_COMMENT_COMPOSER_ENTER_ANIMATION_MS);
}

function finishPromptCommentComposerEnterAnimation() {
    clearPromptCommentComposerEnterAnimation(true);
}

function clearPromptCommentComposerFocusedReleaseTimer() {
    if (promptCommentComposerFocusedReleaseTimer) {
        clearTimeout(promptCommentComposerFocusedReleaseTimer);
        promptCommentComposerFocusedReleaseTimer = null;
    }
}

function clearPromptCommentComposerSettleSyncTimers() {
    promptCommentComposerSettleSyncTimers.forEach((timer) => clearTimeout(timer));
    promptCommentComposerSettleSyncTimers = [];
}

function schedulePromptCommentComposerSettleSync() {
    clearPromptCommentComposerSettleSyncTimers();
    promptCommentComposerSettleSyncTimers = [90, 180, 320, 520].map((delay) => setTimeout(() => {
        const { overlay, input } = getPromptCommentComposerElements();
        if (!overlay?.classList.contains('active')) return;
        if (overlay.classList.contains('composer-closing')) return;
        if (input !== document.activeElement) return;
        syncPromptCommentComposerViewport();
    }, delay));
}

function schedulePromptCommentComposerFocusedRelease() {
    if (promptCommentComposerFocusedReleaseTimer) return;

    promptCommentComposerFocusedReleaseTimer = setTimeout(() => {
        promptCommentComposerFocusedReleaseTimer = null;
        const { overlay, input } = getPromptCommentComposerElements();
        if (!overlay?.classList.contains('active')) return;
        if (overlay.classList.contains('composer-closing')) return;
        if (!promptCommentComposerDocked) return;
        if (input !== document.activeElement) return;

        const liveMetrics = getPromptCommentComposerViewportMetrics();
        if (liveMetrics.bottomInset <= 24) {
            releasePromptCommentComposerDock(true);
        }
    }, 48);
}

function stabilizePromptCommentComposerCaretDuringMotion(duration = 250) {
    const { overlay, input } = getPromptCommentComposerElements();
    if (!overlay || !input || document.activeElement !== input) return;

    clearPromptCommentComposerCaretStabilizer(false);
    overlay.classList.add('composer-caret-stabilizing');
    promptCommentComposerCaretStabilizeTimer = setTimeout(() => {
        clearPromptCommentComposerCaretStabilizer(true);
    }, Math.max(0, duration) + 60);
}

function resetPromptCommentComposerViewportStyles() {
    const { overlay, input, sheet } = getPromptCommentComposerElements();
    if (!overlay) return;
    clearPromptCommentComposerCaretStabilizer(false);
    finishPromptCommentComposerEnterAnimation();
    clearPromptCommentComposerFocusedReleaseTimer();
    if (window.promptCommentComposerAnimRafId) {
        clearTimeout(window.promptCommentComposerAnimRafId);
        window.promptCommentComposerAnimRafId = null;
    }
    if (sheet) {
        sheet.classList.remove('composer-animating');
        setPromptsCssVars(sheet, {
            '--composer-translate-y': null
        });
    }

    setPromptsCssVars(overlay, {
        '--composer-keyboard-offset': '0px'
    });
    overlay.classList.remove('keyboard-active');
    overlay.classList.remove('keyboard-docked-active');
    setPromptsCssVars(input, {
        'max-height': null
    });
    setPromptsCssVars(sheet, {
        height: null,
        'max-height': null
    });
    promptCommentComposerDocked = false;
    promptCommentComposerBlurUndocking = false;
    promptCommentComposerLastBottomInset = 0;
    promptCommentComposerOwnsScrollLock = false;
    promptCommentComposerScrollLockMode = null;
    if (promptCommentComposerInitialDockTimer) {
        clearTimeout(promptCommentComposerInitialDockTimer);
        promptCommentComposerInitialDockTimer = null;
    }
    if (promptCommentComposerInsetDropTimer) {
        clearTimeout(promptCommentComposerInsetDropTimer);
        promptCommentComposerInsetDropTimer = null;
    }
    promptCommentComposerPendingInset = 0;
    if (typeof promptCommentComposerScrollClampCleanup === 'function') {
        promptCommentComposerScrollClampCleanup();
        promptCommentComposerScrollClampCleanup = null;
    }
}

function capturePromptCommentComposerViewportBase() {
    const vv = window.visualViewport;
    const visualTop = Math.max(0, vv?.offsetTop || 0);
    const visualHeight = Math.max(0, vv?.height || 0);
    const visualBottom = visualTop + visualHeight;
    const stableViewportHeight = getPromptCommentComposerStableViewportHeight();
    const layoutHeight = Math.max(
        stableViewportHeight || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualBottom
    );

    // Use the same viewport baseline as the customer-service widget: the layout
    // bottom edge and the largest pre-keyboard visual height, not the prompt
    // card's current geometry. That keeps every card docked to the same rail.
    promptCommentComposerBaseViewportHeight = Math.max(
        promptCommentComposerBaseViewportHeight || 0,
        layoutHeight
    );
    promptCommentComposerBaseVisualHeight = Math.max(
        promptCommentComposerBaseVisualHeight || 0,
        visualHeight
    );
    const { sheet } = getPromptCommentComposerElements();
    if (sheet) {
        const staticHeight = Math.round(sheet.offsetHeight || sheet.getBoundingClientRect().height || 420);
        promptCommentComposerBaseSheetHeight = Math.max(320, staticHeight || 420);
    }
}

function freezePromptCommentComposerOverlay() {
    const { overlay } = getPromptCommentComposerElements();
    if (!overlay) return;
    setPromptsCssVars(overlay, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        width: '100%'
    });
}

function restorePromptCommentComposerOverlay() {
    const { overlay } = getPromptCommentComposerElements();
    if (!overlay) return;
    setPromptsCssVars(overlay, {
        position: null,
        top: null,
        left: null,
        right: null,
        bottom: null,
        width: null,
        height: null
    });
}

function getPromptCommentComposerViewportMetrics() {
    const vv = window.visualViewport;
    const visualTop = Math.max(0, vv?.offsetTop || 0);
    const visualHeight = Math.max(0, vv?.height || 0);
    const visualBottom = visualTop + visualHeight;
    const stableViewportHeight = getPromptCommentComposerStableViewportHeight();
    const baseViewportHeight = Math.max(
        stableViewportHeight || 0,
        promptCommentComposerBaseViewportHeight || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualBottom
    );
    const baseVisualHeight = Math.max(
        promptCommentComposerBaseVisualHeight || 0,
        visualHeight
    );
    const insetFromLayout = Math.max(0, baseViewportHeight - visualBottom);
    const insetFromViewportDelta = Math.max(0, baseVisualHeight - visualHeight);
    const bottomInset = Math.max(insetFromLayout, insetFromViewportDelta);

    return {
        visualHeight,
        visualBottom,
        baseViewportHeight,
        baseVisualHeight,
        bottomInset: Math.max(0, Math.round(bottomInset))
    };
}

function applyPromptCommentComposerDock(bottomInset, animate = false) {
    const { overlay, sheet } = getPromptCommentComposerElements();
    if (!overlay || !sheet) return;
    finishPromptCommentComposerEnterAnimation();
    clearPromptCommentComposerFocusedReleaseTimer();

    if (!promptCommentComposerOwnsScrollLock) {
        lockPromptCommentComposerPage();
    }

    const metrics = getPromptCommentComposerViewportMetrics();
    if (!promptCommentComposerBaseSheetHeight) {
        const liveHeight = Math.round(sheet.offsetHeight || sheet.getBoundingClientRect().height || 400);
        promptCommentComposerBaseSheetHeight = liveHeight || 400;
    }

    const baseSheetHeight = Math.max(320, promptCommentComposerBaseSheetHeight || 400);
    const baseViewportHeight = Math.max(metrics.baseViewportHeight || 0, promptCommentComposerBaseViewportHeight || 0);
    const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
    const minTop = 12;
    const keyboardClearance = PROMPT_COMMENT_COMPOSER_KEYBOARD_CLEARANCE;
    const targetBottom = Math.max(40, Math.round(keyboardTop - keyboardClearance));
    const maxAvailableHeight = Math.max(260, Math.round(targetBottom - minTop));
    const dockHeight = Math.min(baseSheetHeight, maxAvailableHeight);

    setPromptsCssVars(overlay, {
        '--composer-keyboard-offset': `${bottomInset}px`
    });
    overlay.classList.toggle('keyboard-active', bottomInset > 0);
    overlay.classList.toggle('keyboard-docked-active', bottomInset > 0);
    setPromptsCssVars(sheet, {
        height: `${dockHeight}px`,
        'max-height': `${dockHeight}px`,
        '--composer-translate-y': '0px'
    });

    const overlayTop = Math.round(overlay.getBoundingClientRect?.().top || 0);
    const zeroBottom = Math.round(overlayTop + (sheet.offsetTop || 0) + dockHeight);
    const deltaY = Math.max(-520, Math.min(520, Math.round(targetBottom - zeroBottom)));

    if (window.promptCommentComposerAnimRafId) {
        clearTimeout(window.promptCommentComposerAnimRafId);
        window.promptCommentComposerAnimRafId = null;
    }

    sheet.classList.toggle('composer-animating', !!animate);
    if (animate) {
        stabilizePromptCommentComposerCaretDuringMotion(250);
        window.promptCommentComposerAnimRafId = setTimeout(() => {
            sheet.classList.remove('composer-animating');
            clearPromptCommentComposerCaretStabilizer(true);
            window.promptCommentComposerAnimRafId = null;
        }, 250);
    }

    setPromptsCssVars(sheet, {
        '--composer-translate-y': `${deltaY}px`
    });
    promptCommentComposerDocked = bottomInset > 0;
    promptCommentComposerLastBottomInset = Math.max(0, bottomInset);
}

function clampPromptModalPageScroll(duration = 420) {
    const targetY = getPromptModalBaseScrollY();
    const scrollClamp = () => {
        if ((window.scrollY || window.pageYOffset || 0) !== targetY || window.scrollX !== 0) {
            window.scrollTo(0, targetY);
        }
    };

    window.addEventListener('scroll', scrollClamp, { passive: true });
    window.scrollTo(0, targetY);

    return () => {
        window.removeEventListener('scroll', scrollClamp);
        window.scrollTo(0, targetY);
    };
}

function releasePromptCommentComposerDock(animate = false) {
    const { overlay, sheet } = getPromptCommentComposerElements();
    if (!overlay || !sheet) return;
    finishPromptCommentComposerEnterAnimation();
    clearPromptCommentComposerFocusedReleaseTimer();

    setPromptsCssVars(overlay, {
        '--composer-keyboard-offset': '0px'
    });
    overlay.classList.remove('keyboard-active');
    overlay.classList.remove('keyboard-docked-active');
    setPromptsCssVars(sheet, {
        height: null,
        'max-height': null
    });

    if (window.promptCommentComposerAnimRafId) {
        clearTimeout(window.promptCommentComposerAnimRafId);
        window.promptCommentComposerAnimRafId = null;
    }

    sheet.classList.toggle('composer-animating', !!animate);
    if (animate) {
        stabilizePromptCommentComposerCaretDuringMotion(250);
        window.promptCommentComposerAnimRafId = setTimeout(() => {
            sheet.classList.remove('composer-animating');
            clearPromptCommentComposerCaretStabilizer(true);
            window.promptCommentComposerAnimRafId = null;
        }, 250);
    }

    setPromptsCssVars(sheet, {
        '--composer-translate-y': '0px'
    });
    promptCommentComposerDocked = false;
    promptCommentComposerLastBottomInset = 0;
}

function syncPromptCommentComposerViewport() {
    const { overlay, input, sheet } = getPromptCommentComposerElements();
    if (!overlay) return;
    if (!overlay.classList.contains('active')) {
        resetPromptCommentComposerViewportStyles();
        return;
    }

    if (overlay.classList.contains('composer-closing')) {
        return;
    }

    const vv = window.visualViewport;
    if (!vv) {
        resetPromptCommentComposerViewportStyles();
        return;
    }

    const metrics = getPromptCommentComposerViewportMetrics();
    const bottomInset = metrics.bottomInset;
    const isFocused = input === document.activeElement;
    if (!sheet) return;

    if (!isFocused && bottomInset <= 8) {
        promptCommentComposerBlurUndocking = false;
        promptCommentComposerPendingInset = 0;
        if (promptCommentComposerInsetDropTimer) {
            clearTimeout(promptCommentComposerInsetDropTimer);
            promptCommentComposerInsetDropTimer = null;
        }
    }

    const shouldDock = isFocused &&
        !promptCommentComposerBlurUndocking &&
        (promptCommentComposerDocked ? bottomInset > 8 : bottomInset > 24);
    const nextInset = shouldDock ? bottomInset : 0;
    const previousInset = promptCommentComposerLastBottomInset;
    const isInsetDroppingWhileFocused = promptCommentComposerDocked && isFocused && nextInset > 24 && nextInset + 24 < previousInset;

    if (!promptCommentComposerDocked && shouldDock) {
        promptCommentComposerPendingInset = nextInset;
        if (!promptCommentComposerInitialDockTimer) {
            promptCommentComposerInitialDockTimer = setTimeout(() => {
                promptCommentComposerInitialDockTimer = null;
                const liveInput = getPromptCommentComposerElements().input;
                if (document.activeElement !== liveInput) return;
                const liveMetrics = getPromptCommentComposerViewportMetrics();
                if (liveMetrics.bottomInset <= 24) return;
                applyPromptCommentComposerDock(liveMetrics.bottomInset, true);
            }, 90);
        }
        return;
    }

    if (promptCommentComposerInitialDockTimer && (promptCommentComposerDocked || !shouldDock)) {
        clearTimeout(promptCommentComposerInitialDockTimer);
        promptCommentComposerInitialDockTimer = null;
    }

    if (promptCommentComposerInsetDropTimer && (!isInsetDroppingWhileFocused || nextInset >= previousInset)) {
        clearTimeout(promptCommentComposerInsetDropTimer);
        promptCommentComposerInsetDropTimer = null;
        promptCommentComposerPendingInset = 0;
    }

    if (isInsetDroppingWhileFocused) {
        promptCommentComposerPendingInset = 0;
        applyPromptCommentComposerDock(nextInset, false);
        return;
    }

    if (promptCommentComposerDocked && isFocused && nextInset <= 24) {
        schedulePromptCommentComposerFocusedRelease();
        return;
    }

    if (nextInset > 24) {
        applyPromptCommentComposerDock(nextInset, false);
        return;
    }

    if (promptCommentComposerDocked) {
        releasePromptCommentComposerDock(!isFocused && previousInset > 0);
        return;
    }

    setPromptsCssVars(sheet, {
        height: null,
        'max-height': null,
        '--composer-translate-y': '0px'
    });
    setPromptsCssVars(overlay, {
        '--composer-keyboard-offset': '0px'
    });
    overlay.classList.remove('keyboard-active');
    overlay.classList.remove('keyboard-docked-active');
    promptCommentComposerLastBottomInset = 0;
}

function attachPromptCommentComposerViewportSync() {
    const { input } = getPromptCommentComposerElements();
    const vv = window.visualViewport;

    detachPromptCommentComposerViewportSync();
    syncPromptCommentComposerViewport();

    if (!vv) return;

    const handleViewportChange = () => {
        if (promptCommentComposerViewportRafId) return;
        promptCommentComposerViewportRafId = requestAnimationFrame(() => {
            promptCommentComposerViewportRafId = null;
            syncPromptCommentComposerViewport();
        });
    };
    const handleInputFocus = () => {
        promptCommentComposerBlurUndocking = false;
        capturePromptCommentComposerViewportBase();
        lockPromptCommentComposerPage();
        handleViewportChange();
        setTimeout(handleViewportChange, 60);
        setTimeout(handleViewportChange, 120);
        setTimeout(handleViewportChange, 260);
        schedulePromptCommentComposerSettleSync();
    };
    const handleInputBlur = () => {
        promptCommentComposerBlurUndocking = true;
        if (promptCommentComposerDocked) {
            releasePromptCommentComposerDock(true);
        }
        handleViewportChange();
    };

    vv.addEventListener('resize', handleViewportChange, { passive: true });
    vv.addEventListener('scroll', handleViewportChange, { passive: true });
    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('orientationchange', handleViewportChange, { passive: true });
    input?.addEventListener('focus', handleInputFocus);
    input?.addEventListener('blur', handleInputBlur);

    promptCommentComposerViewportCleanup = () => {
        vv.removeEventListener('resize', handleViewportChange);
        vv.removeEventListener('scroll', handleViewportChange);
        window.removeEventListener('resize', handleViewportChange);
        window.removeEventListener('orientationchange', handleViewportChange);
        input?.removeEventListener('focus', handleInputFocus);
        input?.removeEventListener('blur', handleInputBlur);
        if (promptCommentComposerViewportRafId) {
            cancelAnimationFrame(promptCommentComposerViewportRafId);
            promptCommentComposerViewportRafId = null;
        }
    };
}

function ensurePromptCommentComposer() {
    if (!isPromptCommentComposerEnabled()) return null;
    if (promptCommentComposerMounted) return getPromptCommentComposerElements();

    const copy = getPromptCommentComposerI18n();

    const overlay = document.createElement('div');
    overlay.id = 'promptCommentComposer';
    overlay.className = 'prompt-comment-composer';
    overlay.innerHTML = `
        <div class="prompt-comment-composer-sheet">
            <div class="prompt-comment-composer-handle" aria-hidden="true"></div>
            <div class="prompt-comment-composer-header">
                <div class="prompt-comment-composer-copy">
                    <div class="prompt-comment-composer-kicker" data-i18n="gallery.commentsTitle">${copy.commentsTitle}</div>
                    <div class="prompt-comment-composer-title" data-i18n="gallery.commentComposerTitle">${copy.title}</div>
                </div>
            </div>
            <div class="prompt-comment-composer-meta" id="promptCommentComposerMeta"></div>
            <div class="prompt-comment-composer-editor">
                <div class="prompt-comment-composer-empty-placeholder" aria-hidden="true" data-i18n="gallery.commentComposerPlaceholder">${copy.placeholder}</div>
                <textarea id="promptCommentComposerInput" rows="6" placeholder="${copy.placeholder}" data-i18n-placeholder="gallery.commentComposerPlaceholder"></textarea>
                <button type="button" class="prompt-comment-composer-upload prompt-comment-composer-upload-inline" id="promptCommentComposerUploadBtn" title="${copy.attachImage}" aria-label="${copy.attachImage}" data-i18n-title="gallery.attachImage">
                    <i class="fas fa-image"></i>
                </button>
            </div>
            <input type="file" id="promptCommentComposerImageUpload" accept="image/*" class="prompts-comment-image-upload-hidden">
            <div class="prompt-comment-composer-actions">
                <button type="button" class="prompt-comment-composer-send" id="promptCommentComposerSendBtn" data-i18n="gallery.send">
                    ${copy.send}
                </button>
            </div>
        </div>
    `;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closePromptCommentComposer();
        }
    });

    document.body.appendChild(overlay);
    promptCommentComposerMounted = true;

    const { input, sendBtn } = getPromptCommentComposerElements();
    sendBtn?.addEventListener('click', () => submitComment());

    input?.addEventListener('input', () => {
        autoExpandPromptCommentComposerInput(input);
        syncPromptCommentComposerEmptyState();
        syncPromptCommentComposerMeta();
        syncPromptCommentComposerTrigger();
    });
    input?.addEventListener('keydown', handleCommentKeydown);
    input?.addEventListener('focus', () => syncPromptCommentComposerEmptyState());
    input?.addEventListener('blur', () => syncPromptCommentComposerEmptyState());
    bindPromptCommentComposerInputFocusStabilizer(input);

    return getPromptCommentComposerElements();
}

function refreshPromptCommentComposerLanguageUI() {
    const composer = getPromptCommentComposerElements();
    if (!composer?.overlay) return;

    const copy = getPromptCommentComposerI18n();
    const uploadBtn = document.getElementById('promptCommentComposerUploadBtn');
    const sendBtn = document.getElementById('promptCommentComposerSendBtn');
    const placeholder = composer.overlay.querySelector('.prompt-comment-composer-empty-placeholder');

    composer.input?.setAttribute('placeholder', copy.placeholder);

    if (placeholder) {
        placeholder.textContent = copy.placeholder;
    }

    if (uploadBtn) {
        const title = selectedCommentImage ? copy.imageSelected : copy.attachImage;
        uploadBtn.dataset.defaultTitle = copy.attachImage;
        uploadBtn.title = title;
        uploadBtn.setAttribute('aria-label', title);
    }

    if (sendBtn) {
        sendBtn.textContent = copy.send;
    }

    syncPromptCommentComposerMeta();
}

function openPromptCommentComposer(options = {}) {
    if (!isPromptCommentComposerEnabled()) return false;
    const composer = ensurePromptCommentComposer();
    const triggerInput = document.getElementById('commentInput');
    if (!composer?.overlay || !composer.input) return false;
    lockPromptModalCommentModeGeometry({ force: !promptModalKeyboardDock.commentModeGeometryLocked });

    if (options.value !== undefined) {
        composer.input.value = options.value;
    } else if (!composer.input.value && triggerInput?.value) {
        composer.input.value = triggerInput.value;
    }

    if (options.replyTo !== undefined) {
        if (options.replyTo) {
            composer.input.dataset.replyTo = options.replyTo;
        } else {
            delete composer.input.dataset.replyTo;
            delete composer.input.dataset.replyToName;
        }
    } else if (triggerInput?.dataset.replyTo && !composer.input.dataset.replyTo) {
        composer.input.dataset.replyTo = triggerInput.dataset.replyTo;
        if (triggerInput.dataset.replyToName) {
            composer.input.dataset.replyToName = triggerInput.dataset.replyToName;
        }
    }

    if (options.replyToName !== undefined) {
        if (options.replyToName) {
            composer.input.dataset.replyToName = options.replyToName;
        } else {
            delete composer.input.dataset.replyToName;
        }
    }

    // If we're reopening while it was still closing, instantly clear the closing state
    detachPromptCommentComposerViewportSync();
    resetPromptCommentComposerViewportStyles();
    composer.overlay.classList.remove('composer-closing');
    startPromptCommentComposerEnterAnimation(composer.overlay);
    composer.overlay.classList.add('active');
    freezePromptCommentComposerOverlay();
    capturePromptCommentComposerViewportBase();
    autoExpandPromptCommentComposerInput(composer.input);
    syncPromptCommentComposerEmptyState();
    syncPromptCommentComposerMeta();
    syncPromptCommentComposerTrigger();
    attachPromptCommentComposerViewportSync();
    resetPromptModalKeyboardDockIfNeeded(false);
    syncPromptModalTopButtonState();
    initCommentImageUpload();

    if (options.focus !== false) {
        requestAnimationFrame(() => {
            focusPromptCommentComposerInputWithoutScroll(composer.input);
            schedulePromptCommentComposerSettleSync();
        });
    }

    if (options.openFilePicker) {
        setTimeout(() => composer.fileInput?.click(), 80);
    }

    return true;
}

function closePromptCommentComposer(options = {}) {
    const { overlay, input } = getPromptCommentComposerElements();
    if (!overlay) return;

    lockPromptModalCommentModeGeometry();
    detachPromptCommentComposerViewportSync();
    unlockPromptCommentComposerPage();
    clearPromptModalUndockTimer();
    clearPromptModalKeyboardPreLift();

    if (options.clearDraft) {
        clearCommentDraftFields();
        clearSelectedCommentImage();
    } else {
        syncPromptCommentComposerTrigger();
        syncPromptCommentComposerMeta();
    }

    finishPromptCommentComposerEnterAnimation();
    overlay.classList.add('composer-closing');
    input?.blur();

    setTimeout(() => {
        if (!overlay.classList.contains('composer-closing')) return;

        restorePromptCommentComposerOverlay();
        overlay.classList.remove('active', 'composer-closing');
        resetPromptCommentComposerViewportStyles();
        promptCommentComposerBaseViewportHeight = 0;
        promptCommentComposerBaseVisualHeight = 0;
        promptCommentComposerBaseSheetHeight = 0;
        promptCommentComposerDocked = false;
        promptCommentComposerLastBottomInset = 0;
        syncPromptCommentComposerEmptyState();
        lockPromptModalCommentModeGeometry();
        syncPromptModalTopButtonState();

        if (options.preserveModalDock) {
            clearPromptModalUndockTimer();
        } else {
            resetPromptModalKeyboardDockIfNeeded(false);
        }
    }, 260);
}

function getActiveCommentInput() {
    const { overlay, input } = getPromptCommentComposerElements();
    if (isPromptCommentComposerEnabled() && overlay?.classList.contains('active') && input) {
        return input;
    }
    return document.getElementById('commentInput');
}

function getCommentImageUploadBindings() {
    ensurePromptCommentComposer();
    return [
        {
            button: document.getElementById('commentUploadBtn'),
            input: document.getElementById('commentImageUpload')
        },
        {
            button: document.getElementById('promptCommentComposerUploadBtn'),
            input: document.getElementById('promptCommentComposerImageUpload')
        }
    ].filter(binding => binding.button && binding.input);
}

function updateCommentImageUploadButtonsState(title = null) {
    const bindings = getCommentImageUploadBindings();
    const copy = getPromptCommentComposerI18n();
    bindings.forEach(({ button, input }) => {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-image"></i>';
        button.classList.toggle('has-image', !!selectedCommentImage);
        button.dataset.defaultTitle = copy.attachImage;
        button.title = title || (selectedCommentImage
            ? copy.imageSelected
            : copy.attachImage);
        button.setAttribute('aria-label', selectedCommentImage ? copy.imageSelected : copy.attachImage);
        if (!selectedCommentImage) {
            input.value = '';
        }
    });
    syncPromptCommentComposerMeta();
}

function clearSelectedCommentImage() {
    selectedCommentImage = null;
    updateCommentImageUploadButtonsState();
}

// Initialize upload button
function initCommentImageUpload() {
    const bindings = getCommentImageUploadBindings();
    if (!bindings.length) return;

    bindings.forEach(({ button, input }) => {
        if (!button.dataset.defaultTitle) {
            button.dataset.defaultTitle = getPromptCommentComposerI18n().attachImage;
        }

        button.onclick = () => {
            if (button.id === 'commentUploadBtn' && isPromptCommentComposerEnabled()) {
                openPromptCommentComposer({ focus: true, openFilePicker: true });
                return;
            }

            if (selectedCommentImage) {
                if (confirm(getPromptCommentComposerI18n().removeSelectedImageConfirm)) {
                    clearSelectedCommentImage();
                }
                return;
            }

            input.click();
        };

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                alert(getPromptCommentComposerI18n().selectImageFileError);
                input.value = '';
                return;
            }

            bindings.forEach(({ button: eachButton }) => {
                eachButton.disabled = true;
                eachButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                eachButton.title = getPromptCommentComposerI18n().compressingImage;
            });

            try {
                const compressed = await smartCompress(file);

                if (!compressed) {
                    input.value = '';
                    updateCommentImageUploadButtonsState();
                    return;
                }

                let finalFile = compressed;
                if (compressed instanceof Blob && !(compressed instanceof File)) {
                    finalFile = new File([compressed], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                }

                selectedCommentImage = finalFile;

                updateCommentImageUploadButtonsState(buildCommentImageUploadTitle(file, finalFile, compressed));
            } catch (error) {
                console.error('Compression error:', error);
                alert(getPromptCommentComposerI18n().imageCompressFailed);
                input.value = '';
                updateCommentImageUploadButtonsState();
            }
        };
    });

    updateCommentImageUploadButtonsState();
}

// ===========================================
// IMAGE COMPRESSION FOR COMMENTS
// ===========================================

/**
 * Compress image using Canvas API
 * @param {File} file - Original image file
 * @param {number} maxWidth - Maximum width in pixels
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<Blob>} Compressed image blob
 */
async function compressImage(file, maxWidth = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate scale ratio
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to Blob
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Canvas to Blob conversion failed'));
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };

            img.onerror = () => reject(new Error('Image load failed'));
            img.src = e.target.result;
        };

        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

/**
 * Smart progressive compression based on file size
 * @param {File} file - Original image file
 * @returns {Promise<File|Blob|null>} Compressed file or null if rejected
 */
async function smartCompress(file) {
    const size = file.size;
    const sizeMB = (size / 1024 / 1024).toFixed(2);

    // Reject if too large
    if (size > 5 * 1024 * 1024) {
        alert(`图片过大（${sizeMB}MB），请选择小于 5MB 的图片`);
        return null;
    }

    // Small images: upload directly
    if (size < 200 * 1024) {
        console.log(`📷 Small image (${sizeMB}MB), uploading directly`);
        return file;
    }

    // Medium images: compress to 800px
    if (size < 1024 * 1024) {
        console.log(`📷 Medium image (${sizeMB}MB), compressing to 800px`);
        const compressed = await compressImage(file, 800, 0.8);
        const compressedSize = (compressed.size / 1024 / 1024).toFixed(2);
        console.log(`✅ Compressed: ${sizeMB}MB → ${compressedSize}MB`);
        return compressed;
    }

    // Large images: compress to 600px with lower quality
    console.log(`📷 Large image (${sizeMB}MB), compressing to 600px`);
    const compressed = await compressImage(file, 600, 0.75);
    const compressedSize = (compressed.size / 1024 / 1024).toFixed(2);
    console.log(`✅ Compressed: ${sizeMB}MB → ${compressedSize}MB`);
    return compressed;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

// Upload comment image to R2. Do not fall back to Supabase Storage; image serving
// must stay off Supabase egress even when R2 is temporarily unavailable.
async function uploadCommentImage(file) {
    if (!window.supabaseClient) return null;

    const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
    if (!session?.access_token || !session?.user?.id) {
        throw new Error('Please sign in before uploading images');
    }

    const imageData = await fileToDataUrl(file);
    const response = await fetch(
        window.getZaoyoeSupabaseFunctionUrl('upload-avatar'),
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: session.user.id,
                type: 'comment',
                imageData
            })
        }
    );

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok || !payload?.imageUrl) {
        throw new Error(payload?.error || 'R2 image upload failed');
    }

    return payload.imageUrl;
}

// Open image in lightbox
function openImageLightbox(imageUrl) {
    const rawImageUrl = String(imageUrl || '').trim();
    const safeImageUrl = String(window.SiteConfig?.normalizeAssetUrlForCurrentSite?.(rawImageUrl) || rawImageUrl).trim();
    if (!safeImageUrl || isSupabaseStorageImageUrl(safeImageUrl)) return;

    // Create lightbox if doesn't exist
    let lightbox = document.getElementById('imageLightbox');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'imageLightbox';
        lightbox.className = 'image-lightbox';
        lightbox.innerHTML = `
            <button class="lightbox-close" type="button">×</button>
            <img src="" alt="Full size" />
        `;
        document.body.appendChild(lightbox);
        lightbox.querySelector('.lightbox-close')?.addEventListener('click', () => {
            closeImageLightbox();
        });
    }

    // Set image and show
    const img = lightbox.querySelector('img');
    img.src = safeImageUrl;

    requestAnimationFrame(() => {
        lightbox.classList.add('active');
    });

    // Close on background click
    lightbox.onclick = (e) => {
        if (e.target === lightbox) closeImageLightbox();
    };
}

function closeImageLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox) {
        lightbox.classList.remove('active');
    }
}

// ===========================================
//  END IMAGE ATTACHMENTS
// ===========================================

// ===========================================
//  REAL-TIME COMMENT UPDATES
// ===========================================

let realtimeChannel = null;
let realtimeChannelSite = null;
let realtimeSubscription = null;

function normalizePromptInteractionSite(site) {
    return site === 'intl' ? 'intl' : 'cn';
}

function getPromptInteractionSite() {
    return normalizePromptInteractionSite(window.SiteConfig?.site);
}

function getPromptCommentCacheKey(promptId, site = getPromptInteractionSite()) {
    return `${normalizePromptInteractionSite(site)}:${String(promptId || '')}`;
}

// Initialize Supabase Realtime for comments
function initCommentRealtime() {
    if (!window.supabaseClient) return;

    const site = getPromptInteractionSite();
    if (realtimeChannel && realtimeChannelSite === site) return;

    if ((realtimeChannel || realtimeSubscription) && realtimeChannelSite !== site) {
        try {
            realtimeSubscription?.unsubscribe?.();
            if (!realtimeSubscription) {
                realtimeChannel.unsubscribe?.();
            }
        } catch (_) {
            // Ignore cleanup failures during local dev/site swaps.
        }
        realtimeChannel = null;
        realtimeSubscription = null;
    }

    realtimeChannelSite = site;
    if (typeof window.subscribeZaoyoeRealtime === 'function') {
        realtimeSubscription = window.subscribeZaoyoeRealtime({
            client: window.supabaseClient,
            channel: `prompt-comments-updates-${site}`,
            feature: 'prompt_comments',
            timeoutMs: 2600,
            build: (channel) => channel.on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'prompt_comments', filter: `site=eq.${site}` },
                handleRealtimeCommentInsert
            ),
            onDegraded: (reason) => {
                console.warn('[PromptComments] Realtime degraded, using on-open refresh only:', reason);
                realtimeChannel = null;
            }
        });
        realtimeChannel = realtimeSubscription.channel || true;
        return;
    }

    try {
        realtimeChannel = window.supabaseClient
            .channel(`prompt-comments-updates-${site}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'prompt_comments', filter: `site=eq.${site}` },
                handleRealtimeCommentInsert
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    console.warn('[PromptComments] Realtime degraded, using on-open refresh only:', status);
                }
            });
    } catch (error) {
        realtimeChannel = null;
        console.warn('[PromptComments] Realtime unavailable, using on-open refresh only:', error?.message || error);
    }
}

// Handle new comment from realtime
async function handleRealtimeCommentInsert(payload) {
    const comment = payload.new;
    const currentSite = getPromptInteractionSite();
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (normalizePromptInteractionSite(comment.site) !== currentSite) return;

    // Ignore own comments (already rendered optimistically)
    if (user && comment.user_id === user.id) return;

    const modal = document.getElementById('promptModal');
    const isModalOpen = modal?.classList.contains('active');

    if (comment.prompt_id === currentPromptId && isModalOpen) {
        // Scenario 1: Current modal - silent insertion
        await renderRealtimeComment(comment);
    } else {
        // Scenario 2: Other prompt - update count
        await updateCommentCountForPrompt(comment.prompt_id);
    }
}

// Render realtime comment with fade-in animation
async function renderRealtimeComment(comment) {
    // Fetch profile data for the comment
    const { data: profileData } = await window.supabaseClient
        .from('profiles')
        .select('username, avatar_url, email')
        .eq('id', comment.user_id)
        .single();

    const commentWithProfile = {
        ...comment,
        profiles: profileData || { email: 'Anonymous' }
    };

    // Render comment
    renderComment(commentWithProfile, null, null, false, false, false, 0);

    // Add fade-in animation
    const list = document.getElementById('commentList');
    const newCommentEl = list.querySelector(`[data-comment-id="${comment.id}"]`);
    if (newCommentEl) {
        newCommentEl.classList.add('new-comment');
        // Remove animation class after completion
        setTimeout(() => newCommentEl.classList.remove('new-comment'), 500);
    }

    // Update count badge
    const badge = document.getElementById('commentCountBadge');
    const nextCount = normalizePromptCommentCount(parseInt(badge?.textContent || '0', 10) + 1);
    setCachedPromptCommentCount(comment.prompt_id, nextCount, normalizePromptInteractionSite(comment.site));
    applyPromptCommentCount(comment.prompt_id, nextCount);
}

// Update comment count for a specific prompt (Gallery cards)
async function updateCommentCountForPrompt(promptId) {
    const site = getPromptInteractionSite();
    const { count } = await window.supabaseClient
        .from('prompt_comments')
        .select('*', { count: 'exact', head: true })
        .eq('prompt_id', promptId)
        .eq('site', site);

    setCachedPromptCommentCount(promptId, count || 0, site);
    promptCommentCountLoadedAt.set(site, Date.now());

    // Update count in gallery card if visible
    const cards = document.querySelectorAll('.gallery-card');
    cards.forEach(card => {
        const item = PROMPTS.find(p => (p.supabaseId || p.id) === promptId);
        if (item && card.dataset.promptId == item.id) {
            const countEl = card.querySelector('.comment-count');
            if (countEl) countEl.textContent = count || 0;
        }
    });
}

// ===========================================
//  END REAL-TIME UPDATES
// ===========================================

async function fetchCommentCount(promptId) {
    if (!window.supabaseClient) return;
    const site = getPromptInteractionSite();
    const cacheKey = getPromptCommentCacheKey(promptId, site);
    const cachedCount = getCachedPromptCommentCount(promptId, site);

    if (cachedCount !== null) {
        applyPromptCommentCount(promptId, cachedCount);
        return cachedCount;
    }

    try {
        await preloadPromptCommentCounts();
        const preloadedCount = getCachedPromptCommentCount(promptId, site);
        if (preloadedCount !== null) {
            applyPromptCommentCount(promptId, preloadedCount);
            return preloadedCount;
        }
    } catch (error) {
        console.warn('[Comments] Count prefetch fallback failed:', error);
    }

    const { count } = await window.supabaseClient
        .from('prompt_comments')
        .select('*', { count: 'exact', head: true })
        .eq('prompt_id', promptId)
        .eq('site', site);

    const normalizedCount = normalizePromptCommentCount(count);
    promptCommentCountCache.set(cacheKey, normalizedCount);
    promptCommentCountLoadedAt.set(site, Date.now());
    applyPromptCommentCount(promptId, normalizedCount);
    return normalizedCount;
}

// Comment cache to avoid re-fetching
const promptCommentCountCache = new Map();
const promptCommentCountRequests = new Map();
const promptCommentCountLoadedAt = new Map();
const commentCache = new Map();
const commentRequestCache = new Map();
const commentCacheVersions = new Map();
const COMMENT_CACHE_TTL = 30000; // 30 seconds

function normalizePromptCommentCount(count) {
    const parsed = Number.parseInt(count, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}

function getCachedPromptCommentCount(promptId, site = getPromptInteractionSite()) {
    const fullCommentCache = commentCache.get(getPromptCommentCacheKey(promptId, site));
    if (fullCommentCache?.data && Array.isArray(fullCommentCache.data)) {
        return fullCommentCache.data.length;
    }

    const cacheKey = getPromptCommentCacheKey(promptId, site);
    return promptCommentCountCache.has(cacheKey)
        ? normalizePromptCommentCount(promptCommentCountCache.get(cacheKey))
        : null;
}

function setCachedPromptCommentCount(promptId, count, site = getPromptInteractionSite()) {
    const cacheKey = getPromptCommentCacheKey(promptId, site);
    promptCommentCountCache.set(cacheKey, normalizePromptCommentCount(count));
}

function applyPromptCommentCount(promptId, count = null) {
    if (promptId !== currentPromptId) return false;

    const badge = document.getElementById('commentCountBadge');
    if (!badge) return false;

    if (count === null || count === undefined) {
        badge.textContent = '';
        badge.classList.add('comment-count--hidden');
        updateCommentSectionHeading(0);
        return false;
    }

    const normalizedCount = normalizePromptCommentCount(count);
    badge.textContent = String(normalizedCount);
    badge.classList.remove('comment-count--hidden');
    updateCommentSectionHeading(normalizedCount);
    return true;
}

async function preloadPromptCommentCounts(forceRefresh = false) {
    if (!window.supabaseClient || typeof PROMPTS === 'undefined' || PROMPTS.length === 0) {
        return null;
    }

    const site = getPromptInteractionSite();
    const lastLoadedAt = promptCommentCountLoadedAt.get(site) || 0;
    const isFresh = !forceRefresh && (Date.now() - lastLoadedAt < COMMENT_CACHE_TTL);
    if (isFresh) {
        return promptCommentCountCache;
    }

    const existingRequest = promptCommentCountRequests.get(site);
    if (existingRequest) {
        return existingRequest;
    }

    const promptIds = Array.from(new Set(
        PROMPTS
            .map((prompt) => String(prompt?.supabaseId || prompt?.id || '').trim())
            .filter(Boolean)
    ));
    if (promptIds.length === 0) {
        return null;
    }

    const request = window.supabaseClient
        .from('prompt_comments')
        .select('prompt_id')
        .eq('site', site)
        .then(({ data, error }) => {
            if (error) {
                throw error;
            }

            const counts = new Map(promptIds.map((promptId) => [promptId, 0]));
            (data || []).forEach((row) => {
                const promptId = String(row?.prompt_id || '').trim();
                if (!promptId) return;
                counts.set(promptId, (counts.get(promptId) || 0) + 1);
            });

            counts.forEach((count, promptId) => {
                setCachedPromptCommentCount(promptId, count, site);
            });

            promptCommentCountLoadedAt.set(site, Date.now());
            if (currentPromptId) {
                applyPromptCommentCount(currentPromptId, getCachedPromptCommentCount(currentPromptId, site));
            }

            return counts;
        })
        .finally(() => {
            if (promptCommentCountRequests.get(site) === request) {
                promptCommentCountRequests.delete(site);
            }
        });

    promptCommentCountRequests.set(site, request);
    return request;
}

function invalidatePromptCommentsCache(promptId, site = getPromptInteractionSite()) {
    const cacheKey = getPromptCommentCacheKey(promptId, site);
    commentCache.delete(cacheKey);
    commentRequestCache.delete(cacheKey);
    commentCacheVersions.set(cacheKey, (commentCacheVersions.get(cacheKey) || 0) + 1);
}

async function loadPromptCommentsData(promptId, forceRefresh = false) {
    if (!window.supabaseClient) return null;

    const site = getPromptInteractionSite();
    const cacheKey = getPromptCommentCacheKey(promptId, site);
    const cached = commentCache.get(cacheKey);
    const isCacheValid = cached && (Date.now() - cached.timestamp < COMMENT_CACHE_TTL);

    if (!forceRefresh && isCacheValid) {
        return cached;
    }

    const existingRequest = commentRequestCache.get(cacheKey);
    if (existingRequest) {
        return existingRequest;
    }

    const requestVersion = commentCacheVersions.get(cacheKey) || 0;
    const request = (async () => {
        let currentUserId = window._cachedUserId;
        let currentUserAvatar = window._cachedUserAvatar;

        const [userResult, commentsResult, allLikes] = await Promise.all([
            !currentUserId ? window.supabaseClient.auth.getUser() : Promise.resolve({ data: { user: { id: currentUserId } } }),
            window.supabaseClient
                .from('prompt_comments')
                .select(`*, is_pinned, is_featured, profiles:user_id (id, username, avatar_url)`)
                .eq('prompt_id', promptId)
            .eq('site', site)
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: true }),
            window.supabaseClient
            .from('comment_likes')
            .select('comment_id, user_id')
            .eq('site', site)
        ]);

        if (!currentUserId && userResult.data?.user) {
            currentUserId = userResult.data.user.id;
            window._cachedUserId = currentUserId;

            if (!currentUserAvatar && currentUserId) {
                const { data: profile } = await window.supabaseClient
                    .from('profiles')
                    .select('avatar_url')
                    .eq('id', currentUserId)
                    .single();

                const dbAvatar = profile?.avatar_url;
                if (dbAvatar && dbAvatar.trim() !== '' &&
                    (dbAvatar.startsWith('http') || (dbAvatar.startsWith('data:') && dbAvatar.length > 100))) {
                    currentUserAvatar = dbAvatar;
                    window._cachedUserAvatar = currentUserAvatar;
                }
            }
        }

        const { data, error } = commentsResult;
        if (error) {
            throw error;
        }

        const commentIds = new Set(data.map(c => c.id));
        const userLikedCommentIds = new Set();
        const commentLikeCounts = new Map();

        if (allLikes.data) {
            allLikes.data.forEach((like) => {
                if (!commentIds.has(like.comment_id)) return;

                if (like.user_id === currentUserId) {
                    userLikedCommentIds.add(like.comment_id);
                }
                commentLikeCounts.set(
                    like.comment_id,
                    (commentLikeCounts.get(like.comment_id) || 0) + 1
                );
            });
        }

        const payload = {
            timestamp: Date.now(),
            data,
            currentUserId,
            currentUserAvatar,
            userLikedCommentIds: [...userLikedCommentIds],
            commentLikeCounts: Object.fromEntries(commentLikeCounts)
        };

        if ((commentCacheVersions.get(cacheKey) || 0) !== requestVersion) {
            return commentCache.get(cacheKey) || null;
        }

        commentCache.set(cacheKey, {
            ...payload
        });
        setCachedPromptCommentCount(promptId, data.length, site);
        promptCommentCountLoadedAt.set(site, Date.now());
        return commentCache.get(cacheKey);
    })().finally(() => {
        if (commentRequestCache.get(cacheKey) === request) {
            commentRequestCache.delete(cacheKey);
        }
    });

    commentRequestCache.set(cacheKey, request);
    return request;
}

function prefetchComments(promptId, forceRefresh = false) {
    if (!promptId) return Promise.resolve(null);

    return loadPromptCommentsData(promptId, forceRefresh).catch((error) => {
        console.warn('[Comments] Prefetch failed:', error);
        return null;
    });
}

// Render comments from cache (instant, no network)
function renderCommentsFromCache(cached, list) {
    const { data, currentUserId, currentUserAvatar, userLikedCommentIds, commentLikeCounts } = cached;
    const likedSet = new Set(userLikedCommentIds);
    const countMap = new Map(Object.entries(commentLikeCounts));

    updateCommentSectionHeading(data.length);

    list.classList.remove('comment-list-empty');
    list.innerHTML = '';
    if (data.length === 0) {
        updateCommentSectionHeading(0);
        renderCommentEmptyState(list);
        return;
    }

    const commentMap = new Map();
    data.forEach(c => commentMap.set(c.id, c));

    const replyMap = new Map();
    data.filter(c => c.parent_id).forEach(reply => {
        if (!replyMap.has(reply.parent_id)) {
            replyMap.set(reply.parent_id, []);
        }
        replyMap.get(reply.parent_id).push(reply);
    });

    let rootComments = data.filter(c => !c.parent_id);

    // --- SORTING LOGIC ---
    // Sort only root comments (threads). Replies remain chronological.
    const sortType = localStorage.getItem('commentSortPreference') || 'newest';

    // Update UI Label
    const sortLabel = document.getElementById('currentSortLabel');
    if (sortLabel) {
        const labels = getCommentSortLabels();
        sortLabel.textContent = labels[sortType] || labels.newest;
    }

    if (sortType === 'newest') {
        // Default: Newest first (already sorted by DB usually, but ensure it)
        rootComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortType === 'oldest') {
        // Oldest first
        rootComments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sortType === 'top') {
        // Top: Most likes first
        rootComments.sort((a, b) => {
            const likesA = countMap.get(a.id) || 0;
            const likesB = countMap.get(b.id) || 0;
            if (likesB !== likesA) return likesB - likesA;
            // Fallback to newest if likes are equal
            return new Date(b.created_at) - new Date(a.created_at);
        });
    }

    // Recursive function to collect all replies in a thread (flattened)
    const collectAllReplies = (commentId, collected = []) => {
        const directReplies = replyMap.get(commentId) || [];
        directReplies.forEach(reply => {
            collected.push(reply);
            collectAllReplies(reply.id, collected);
        });
        return collected;
    };

    // Render a single comment
    const renderSingleComment = (comment, isReply, isLastInThread) => {
        const overrideAvatar = (comment.user_id === currentUserId) ? currentUserAvatar : null;
        const hasReplies = (replyMap.get(comment.id) || []).length > 0;
        const parentProfile = comment.parent_id ? commentMap.get(comment.parent_id)?.profiles : null;
        const isLiked = likedSet.has(comment.id);
        const likeCount = countMap.get(comment.id) || 0;

        renderComment(comment, overrideAvatar, parentProfile, hasReplies, isLastInThread, isLiked, likeCount);
    };

    // Render all root comments and their flattened replies
    rootComments.forEach(rootComment => {
        renderSingleComment(rootComment, false, false);

        const allReplies = collectAllReplies(rootComment.id);
        allReplies.forEach((reply, index) => {
            const isLast = index === allReplies.length - 1;
            renderSingleComment(reply, true, isLast);
        });
    });

    // Apply collapse logic (updates header title)
    initCommentCollapse();
}

async function fetchComments(promptId, forceRefresh = false) {
    if (!window.supabaseClient) return;
    const list = document.getElementById('commentList');
    const site = getPromptInteractionSite();
    const cacheKey = getPromptCommentCacheKey(promptId, site);

    // Check cache first
    const cached = commentCache.get(cacheKey);
    const isCacheValid = cached && (Date.now() - cached.timestamp < COMMENT_CACHE_TTL);

    // Strategy: Stale-While-Revalidate
    // - If cache is valid: use it immediately, no network
    // - If cache is stale but exists: show stale data first, refresh in background
    // - If no cache: show loading, fetch fresh data

    if (!forceRefresh && isCacheValid) {
        // Fresh cache: use it and return
        renderCommentsFromCache(cached, list);
        return;
    }

    if (!forceRefresh && cached) {
        // Stale cache: show it immediately (no loading flash)
        renderCommentsFromCache(cached, list);
        // Continue to refresh in background (don't return)
    } else {
        // No cache: show loading
        list.classList.add('comment-list-empty');
        list.innerHTML = `<div class="comment-empty-state" data-state="loading"><div class="comment-empty-subtitle">${window.i18n?.t('common.loading') || 'Loading...'}</div></div>`;
    }

    let loadedComments;
    try {
        loadedComments = await loadPromptCommentsData(promptId, forceRefresh);
    } catch (error) {
        console.error("Comment Load Error:", error);
        list.classList.add('comment-list-empty');
        list.innerHTML = `<div class="comment-empty-state" data-state="error"><div class="comment-empty-subtitle comment-empty-subtitle--error">${window.i18n?.t('common.error') || 'Failed to load comments'}</div></div>`;
        return;
    }
    if (!loadedComments) return;
    if (promptId !== currentPromptId) return;

    renderCommentsFromCache(loadedComments, list);

    setTimeout(() => {
        list.scrollTop = 0;
    }, 100);
}

// ============================================
// COMMENT COLLAPSE/EXPAND - CLEAN REWRITE
// Uses data attribute for state, direct DOM manipulation
// Shows only PARENT comments when collapsed (not replies)
// ============================================

const COLLAPSE_SHOW_COUNT = 3;

/**
 * Initialize comment collapse on page load or after rendering
 * Call this after comments are rendered to the DOM
 */
function initCommentCollapse() {
    const list = document.getElementById('commentList');
    const title = document.getElementById('commentSectionTitle');

    if (!list || !title) return;

    const allComments = Array.from(list.children);
    const total = allComments.length;

    // Separate parent comments from replies
    const parentComments = allComments.filter(c => !c.classList.contains('comment-reply'));
    const parentCount = parentComments.length;

    console.log('[Collapse] Initializing with', total, 'total,', parentCount, 'parents');

    if (isPromptModalExpandedCommentView()) {
        updateCommentSectionHeading(parentCount);
        title.classList.remove('comment-header-title--expandable');
        title.classList.add('comment-header-title--static');
        title.removeAttribute('data-expandable');
        list.classList.remove('collapsed');
        allComments.forEach((comment) => comment.classList.remove('hidden-collapsed'));
        if (!title.dataset.collapseBound) {
            title.addEventListener('click', handleCollapseToggle);
            title.dataset.collapseBound = '1';
        }
        return;
    }

    updateCommentSectionHeading(parentCount);

    // If 3 or fewer parent comments, no collapse needed
    if (parentCount <= COLLAPSE_SHOW_COUNT) {
        title.classList.remove('comment-header-title--expandable');
        title.classList.add('comment-header-title--static');
        title.removeAttribute('data-expandable');
        list.classList.remove('collapsed');
        // Make sure all are visible
        allComments.forEach((comment) => comment.classList.remove('hidden-collapsed'));
        if (!title.dataset.collapseBound) {
            title.addEventListener('click', handleCollapseToggle);
            title.dataset.collapseBound = '1';
        }
        return;
    }

    // Mark as expandable and collapsed
    title.classList.add('comment-header-title--expandable');
    title.classList.remove('comment-header-title--static');
    title.setAttribute('data-expandable', 'true');
    list.classList.add('collapsed');
    setCommentCollapseVisibility(allComments, true);

    if (!title.dataset.collapseBound) {
        title.addEventListener('click', handleCollapseToggle);
        title.dataset.collapseBound = '1';
    }
}

/**
 * Handle click on the collapse toggle
 */
function handleCollapseToggle() {
    const list = document.getElementById('commentList');
    const title = document.getElementById('commentSectionTitle');

    if (!list || !title) return;
    if (title.getAttribute('data-expandable') !== 'true') return;

    const isCollapsed = list.classList.contains('collapsed');
    const allComments = Array.from(list.children);
    const total = allComments.length;

    console.log('[Collapse] Toggle clicked, isCollapsed:', isCollapsed, 'total:', total);

    if (isCollapsed) {
        // EXPAND: Show all comments
        setCommentCollapseVisibility(allComments, false);
        list.classList.remove('collapsed');
        title.textContent = window.i18n?.t('gallery.hideComments') || 'Hide comments';

        // Ensure list is scrollable and scroll to top
        list.scrollTop = 0;
    } else {
        // COLLAPSE: Show only first 3 PARENT comments
        setCommentCollapseVisibility(allComments, true);
        list.classList.add('collapsed');
        updateCommentSectionHeading(allComments.filter(c => !c.classList.contains('comment-reply')).length);

        // Scroll to top when collapsed
        list.scrollTop = 0;
    }
}

// Expose globally for debugging
window.initCommentCollapse = initCommentCollapse;
window.handleCollapseToggle = handleCollapseToggle;

function renderComment(comment, overrideAvatar = null, replyToProfile = null, hasReplies = false, isLastReply = false, isLiked = false, likeCount = 0) {
    const list = document.getElementById('commentList');
    if (!list) return;

    if (list.classList.contains('comment-list-empty')) {
        list.classList.remove('comment-list-empty');
        list.innerHTML = '';
    }

    // Handle various profile structures (standard vs metadata)
    const profile = comment.profiles || {};

    // Priority: Profile username -> Metadata name -> Email prefix -> 'Anonymous'
    const name = profile.username || (profile.email ? profile.email.split('@')[0] : 'Anonymous');

    // Robust Avatar Resolution - prioritize override from session
    const avatarUrl = overrideAvatar || getAvatarUrl(profile);
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6b9ece&color=fff`;

    // Determine if this is a reply
    const isReply = !!comment.parent_id;
    const replyToName = replyToProfile?.username || 'someone';

    // Build "Replying to" HTML if this is a reply
    const replyingToHtml = isReply
        ? `<div class="comment-replying-to">${window.i18n?.t('gallery.replyingTo') || 'Replying to'} <span class="comment-mention">@${escapeHtml(replyToName)}</span></div>`
        : '';

    // Remove leading @replyToName from content if it duplicates the "Replying to" display
    let displayContent = comment.content;
    if (isReply && replyToName) {
        // Match @username (case insensitive) at the start of content
        const mentionPattern = new RegExp(`^@${replyToName}\\s*`, 'i');
        displayContent = displayContent.replace(mentionPattern, '').trim();
    }

    // Determine heart icon class and style based on isLiked
    const heartIconClass = isLiked ? 'fas fa-heart' : 'far fa-heart';

    const div = document.createElement('div');
    div.className = 'comment-item' +
        (isReply ? ' comment-reply' : '') +
        (hasReplies ? ' has-replies' : '') +
        (isLastReply ? ' last-reply' : '') +
        (comment.is_featured ? ' featured-comment' : '') +
        (comment.is_pinned ? ' pinned-comment' : '');
    div.dataset.commentId = comment.id;
    div.innerHTML = `
        ${isReply ? '<div class="thread-line"></div>' : ''}
        <img src="${avatarUrl}" class="comment-avatar" alt="${name}">
        <div class="comment-body">
            ${replyingToHtml}
            <div class="comment-header">
                <span class="comment-author">
                    ${escapeHtml(name)} 
                    ${isAdminUser(comment.profiles?.email) ? '✨' : ''}
                </span>
                <span class="comment-time" title="${new Date(comment.created_at).toLocaleString()}">${formatCommentTime(comment.created_at)}</span>
            </div>
            <div class="comment-content">${formatMentions(displayContent)}</div>
            <div class="comment-actions">
                <button class="comment-action-btn like-btn${isLiked ? ' liked' : ''}" data-liked="${isLiked}">
                    <i class="${heartIconClass}"></i> <span class="like-count">${likeCount}</span>
                </button>
                <button class="comment-action-btn reply-btn">${window.i18n?.t('gallery.reply') || 'Reply'}</button>
                ${comment.image_url && !isSupabaseStorageImageUrl(comment.image_url) ? `
                    <button class="comment-action-btn view-image-btn" type="button">
                        <i class="far fa-image"></i> ${window.i18n?.t('gallery.viewImage') || 'View Image'}
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    // Add event listeners
    const likeBtn = div.querySelector('.like-btn');
    const replyBtn = div.querySelector('.reply-btn');
    const viewImageBtn = div.querySelector('.view-image-btn');
    const avatarImage = div.querySelector('.comment-avatar');

    likeBtn.addEventListener('click', () => handleLikeComment(comment.id, likeBtn));
    replyBtn.addEventListener('click', () => handleReplyComment(comment.id, name));
    viewImageBtn?.addEventListener('click', () => openImageLightbox(comment.image_url));
    avatarImage?.addEventListener('error', () => {
        if (avatarImage.dataset.fallbackApplied === '1') return;
        avatarImage.dataset.fallbackApplied = '1';
        avatarImage.src = fallbackUrl;
    });

    list.appendChild(div);
}

async function handleLikeComment(commentId, button) {
    if (!window.supabaseClient) {
        alert('请登录后点赞');
        return;
    }

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        showLoginModal();
        return;
    }

    const site = getPromptInteractionSite();

    const isLiked = button.dataset.liked === 'true';
    const icon = button.querySelector('i');
    const countSpan = button.querySelector('.like-count');
    let currentCount = parseInt(countSpan.textContent) || 0;

    // Optimistic UI update
    if (isLiked) {
        // Unlike
        icon.className = 'far fa-heart';
        button.classList.remove('liked');
        countSpan.textContent = Math.max(0, currentCount - 1);
        button.dataset.liked = 'false';
    } else {
        // Like
        icon.className = 'fas fa-heart';
        button.classList.add('liked');
        countSpan.textContent = currentCount + 1;
        button.dataset.liked = 'true';
    }

    // Update database - only manage comment_likes table, count is derived from there
    try {
        if (isLiked) {
            // Remove like from comment_likes table
            await window.supabaseClient
                .from('comment_likes')
                .delete()
                .eq('comment_id', commentId)
                .eq('user_id', user.id)
                .eq('site', site);
        } else {
            // Add like to comment_likes table
            await window.supabaseClient
                .from('comment_likes')
                .insert({ comment_id: commentId, user_id: user.id, site });
        }
    } catch (err) {
        console.error('Like error:', err);
        // Revert on error
        countSpan.textContent = currentCount;
        button.dataset.liked = isLiked ? 'true' : 'false';
        icon.className = isLiked ? 'fas fa-heart' : 'far fa-heart';
        button.classList.toggle('liked', isLiked);
    }
}

function handleReplyComment(commentId, authorName) {
    const input = getActiveCommentInput();
    if (input) {
        input.value = `@${authorName} `;
        input.dataset.replyTo = commentId;
        input.dataset.replyToName = authorName;

        if (isPromptCommentComposerEnabled()) {
            openPromptCommentComposer({
                focus: true,
                value: input.value,
                replyTo: commentId,
                replyToName: authorName
            });
        } else {
            try {
                input.focus({ preventScroll: true });
            } catch (_) {
                input.focus();
            }
            primePromptModalKeyboardDock();
        }
    }
}

// Avatar URL cache to avoid 429 errors from Google CDN
const avatarUrlCache = new Map();

function getAvatarUrl(profile) {
    // Consistent fallback for all avatars (Starry Blue)
    const getDefaultAvatar = (identifier) =>
        `https://ui-avatars.com/api/?name=${encodeURIComponent(identifier || 'User')}&background=6b9ece&color=fff`;

    // Identifier for fallback (prefer username or nothing)
    const identifier = profile?.username || profile?.user_metadata?.full_name || 'User';
    const DEFAULT_AVATAR = getDefaultAvatar(identifier);

    // Helper to validate avatar URL
    const isValidUrl = (url) => {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return false;

        if (trimmed.startsWith('data:')) {
            // Check base64 length (prevent 1x1 pixel images)
            return trimmed.length > 100;
        }

        return trimmed.startsWith('http');
    };

    // Helper to check if URL is from Google CDN (prone to 429 errors)
    const isGoogleCDN = (url) => {
        return url && (url.includes('googleusercontent.com') || url.includes('ggpht.com'));
    };

    if (!profile) return DEFAULT_AVATAR;

    // Check cache first
    const profileId = profile.id || profile.user_id;
    if (profileId && avatarUrlCache.has(profileId)) {
        return avatarUrlCache.get(profileId);
    }

    let avatarUrl = null;

    // 1. Try direct avatar_url from profile (DB) - highest priority
    if (isValidUrl(profile.avatar_url)) {
        avatarUrl = profile.avatar_url.trim();
    }
    // 2. Try metadata avatar (Auth)
    else {
        const meta = profile.user_metadata || {};
        if (isValidUrl(meta.avatar_url)) {
            avatarUrl = meta.avatar_url.trim();
        }
    }

    // If URL is from Google CDN, use fallback to avoid 429 errors
    // Google avatars are cached in their CDN but have rate limits
    if (avatarUrl && isGoogleCDN(avatarUrl)) {
        console.warn('⚠️ Google CDN avatar detected, using fallback to avoid 429:', avatarUrl.substring(0, 60));
        avatarUrl = DEFAULT_AVATAR;
    }

    // Use fallback if no valid URL found
    const finalUrl = avatarUrl || DEFAULT_AVATAR;

    // Cache the result
    if (profileId) {
        avatarUrlCache.set(profileId, finalUrl);
    }

    return finalUrl;
}

function isAdminUser(email) {
    return email === 'zaoyoe@gmail.com'; // Hardcoded check matching existing logic
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMentions(text) {
    // First escape HTML, then wrap @mentions in styled spans
    const escaped = escapeHtml(text);
    return escaped.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
}

function autoExpandTextarea(textarea) {
    const maxHeight = 120; // Max ~5 lines, matches CSS max-height
    applyPromptsTextareaAutoHeight(textarea, maxHeight);
}

function handleCommentKeydown(e) {
    // Shift+Enter: insert newline (default behavior for textarea)
    // Enter alone: submit comment
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent newline
        submitComment();
    }
}

function restoreCommentDraft(input, content, parentId = null, replyToName = '') {
    if (!input) return;
    input.value = content;
    if (parentId) {
        input.dataset.replyTo = parentId;
    } else {
        delete input.dataset.replyTo;
    }
    if (replyToName) {
        input.dataset.replyToName = replyToName;
    } else {
        delete input.dataset.replyToName;
    }

    if (input.id === 'promptCommentComposerInput') {
        autoExpandPromptCommentComposerInput(input);
        syncPromptCommentComposerMeta();
        syncPromptCommentComposerTrigger();
    } else {
        autoExpandTextarea(input);
    }
}

/* ==================== 封禁检查辅助函数 ==================== */
async function checkUserBlockStatus(userId, scope = 'gallery') {
    if (!window.supabaseClient) return false;

    // Check for explicit block
    const { data: blocks, error } = await window.supabaseClient
        .from('blocked_users')
        .select('id, user_id, scope, expires_at')
        .eq('user_id', userId)
        .or(`scope.eq.all,scope.eq.${scope}`);

    if (error || !blocks || blocks.length === 0) return false;

    // Check expiration
    const now = new Date();
    const activeBlock = blocks.find(b => {
        if (!b.expires_at) return true; // Permanent
        return new Date(b.expires_at) > now; // Temporary and still active
    });

    if (activeBlock) {
        const type = activeBlock.expires_at ? '临时' : '永久';
        const dateStr = activeBlock.expires_at ? new Date(activeBlock.expires_at).toLocaleDateString() : '';
        const msg = activeBlock.expires_at
            ? `您已被${type}封禁，解封时间：${dateStr}`
            : `您已被永久封禁`;
        return { blocked: true, message: msg };
    }

    return false;
}

async function submitComment() {
    if (!window.supabaseClient) return;

    const input = getActiveCommentInput();
    const content = input.value.trim();
    const site = getPromptInteractionSite();

    // Check auth first so unauthenticated users always get feedback
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        const flashedComposer = flashPromptCommentComposerAuthRequired();
        if (flashedComposer) {
            queuePromptCommentComposerLoginModal(PROMPT_COMMENT_COMPOSER_AUTH_ALERT_DURATION_MS);
        } else {
            showLoginModal();
        }
        return;
    }

    // Allow empty content if there's an image attached
    if (!content && !selectedCommentImage) {
        return;
    }

    // 🛑 Block Check
    const blockStatus = await checkUserBlockStatus(user.id, 'gallery');
    if (blockStatus && blockStatus.blocked) {
        alert(blockStatus.message || '您已被限制发言');
        return;
    }

    // 🔍 敏感词检查
    if (content) {
        const sensitiveCheck = await checkGallerySensitiveContent(content);
        if (sensitiveCheck.blocked) {
            showGalleryToast('内容包含敏感词，请修改后重试', 'warning', 4000);
            return;
        }
    }

    // Get parent_id if this is a reply
    const parentId = input.dataset.replyTo || null;

    // Handle Reply Content: Strip the leading @username if present
    // The UI shows "Replying to @User" separately, so we don't need it in the body
    let cleanContent = content;
    if (parentId && content.startsWith('@')) {
        // Remove the first word (which is likely the @mention) and leading spaces
        cleanContent = content.replace(/^@\S+\s*/, '');
    }

    // Store for potential rollback (use original input for rollback UI)
    const originalContent = cleanContent;
    const originalParentId = parentId;
    const originalReplyToName = input.dataset.replyToName || '';

    // Clear input IMMEDIATELY for instant feedback
    input.value = '';
    // Reset textarea height to original single-line
    resetPromptsTextareaAutoHeight(input);
    delete input.dataset.replyTo;
    delete input.dataset.replyToName;

    // Get cached avatar
    const currentUserAvatar = window._cachedUserAvatar;

    // Upload image if selected
    let imageUrl = null;
    if (selectedCommentImage) {
        imageUrl = await uploadCommentImage(selectedCommentImage);
        if (!imageUrl) {
            alert('Failed to upload image');
            restoreCommentDraft(input, originalContent, originalParentId, originalReplyToName);
            return;
        }
    }

    // Build insert data
    const insertData = {
        prompt_id: currentPromptId,
        user_id: user.id,
        content: originalContent || '[图片]' // Default text for image-only comments
    };
    insertData.site = site;

    if (originalParentId) {
        insertData.parent_id = originalParentId;
    }

    if (imageUrl) {
        insertData.image_url = imageUrl;
    }

    // Insert to DB (without expensive JOIN for speed)
    const { data, error } = await window.supabaseClient
        .from('prompt_comments')
        .insert(insertData)
        .select('id')
        .single();

    if (error) {
        console.error('Failed to post comment:', error);
        restoreCommentDraft(input, originalContent, originalParentId, originalReplyToName);
        alert("Failed to post comment");
        return;
    }
    window.ZaoyoeAdminPresence?.markActive?.();

    // Build comment object with cached user data
    const newComment = {
        id: data.id,
        prompt_id: currentPromptId,
        site,
        user_id: user.id,
        content: originalContent,
        parent_id: originalParentId,
        created_at: new Date().toISOString(),
        image_url: imageUrl,
        profiles: {
            username: window._cachedUserProfile?.username || user.email?.split('@')[0] || 'You',
            avatar_url: currentUserAvatar
        }
    };

    // Extract parent username from input (for immediate optimistic render only)
    let parentProfile = null;
    if (originalParentId) {
        // We look at the RAW input (input.value was cleared, but 'content' holds it)
        // actually 'content' is the raw input before cleaning.
        // Let's rely on the fact that reply logic sets up the placeholder/value
        const rawInput = content;
        const mentionMatch = rawInput.match(/^@(\S+)/);
        if (mentionMatch) {
            parentProfile = { username: mentionMatch[1] };
        }
    }

    // Render immediately
    renderComment(
        newComment,
        currentUserAvatar,
        parentProfile,
        false,
        false,
        false,
        0
    );

    // Auto-scroll
    setTimeout(() => {
        const list = document.getElementById('commentList');
        const elem = list?.querySelector(`[data-comment-id="${data.id}"]`);
        if (elem) elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    // Update badge
    const badge = document.getElementById('commentCountBadge');
    const nextCount = normalizePromptCommentCount(parseInt(badge?.textContent || '0', 10) + 1);
    setCachedPromptCommentCount(currentPromptId, nextCount, site);
    applyPromptCommentCount(currentPromptId, nextCount);

    // Clear image selection after successful submission
    if (selectedCommentImage) {
        clearSelectedCommentImage();
    }

    if (isPromptCommentComposerEnabled()) {
        closePromptCommentComposer({ clearDraft: true });
    }

    // Invalidate cache
    commentCache.delete(getPromptCommentCacheKey(currentPromptId, site));
    invalidatePromptCommentsCache(currentPromptId, site);
}

// --- Sorting UI Logic ---
function positionCommentSortDropdown() {
    const btn = document.getElementById('commentSortBtn');
    const dropdown = document.getElementById('commentSortDropdown');
    if (!btn || !dropdown || !dropdown.classList.contains('show')) return;

    const rect = btn.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const dropdownWidth = dropdown.offsetWidth || 156;
    const top = Math.round(rect.bottom + 8);
    const left = Math.round(Math.min(
        Math.max(12, rect.right - dropdownWidth),
        Math.max(12, viewportWidth - dropdownWidth - 12)
    ));

    setPromptsCssVars(dropdown, {
        top: `${top}px`,
        left: `${left}px`,
        right: 'auto'
    });
}

function setCommentSortDropdownOpen(open) {
    const btn = document.getElementById('commentSortBtn');
    const dropdown = document.getElementById('commentSortDropdown');
    if (!btn || !dropdown) return;

    if (dropdown.parentElement !== document.body) {
        document.body.appendChild(dropdown);
    }
    dropdown.classList.add('floating');

    dropdown.classList.toggle('show', !!open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
        positionCommentSortDropdown();
    }
}

function setupCommentSorting() {
    const btn = document.getElementById('commentSortBtn');
    const dropdown = document.getElementById('commentSortDropdown');
    const options = document.querySelectorAll('.sort-option');

    if (!btn || !dropdown) return;

    if (dropdown.parentElement !== document.body) {
        document.body.appendChild(dropdown);
    }
    dropdown.classList.add('floating');

    // Toggle Dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setCommentSortDropdownOpen(!dropdown.classList.contains('show'));
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
            setCommentSortDropdownOpen(false);
        }
    });

    window.addEventListener('resize', () => setCommentSortDropdownOpen(false));
    window.visualViewport?.addEventListener('resize', () => setCommentSortDropdownOpen(false), { passive: true });
    window.visualViewport?.addEventListener('scroll', () => setCommentSortDropdownOpen(false), { passive: true });

    // Handle Option Click
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            const sortType = opt.dataset.sort;

            // Save preference
            localStorage.setItem('commentSortPreference', sortType);

            // Update Active State
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');

            // Close Dropdown
            setCommentSortDropdownOpen(false);

            // Trigger Re-render if we have cached data
            const cached = commentCache.get(getPromptCommentCacheKey(currentPromptId));
            if (cached) {
                const list = document.getElementById('commentList');
                // clear list first to show change
                list.innerHTML = '';
                renderCommentsFromCache(cached, list);
            }
        });
    });
}

function refreshCommentLanguageUI() {
    updateCommentSectionHeading();
    refreshCommentImageUploadLanguageUI();
    refreshPromptCommentComposerLanguageUI();
    updatePromptCommentComposerTriggerState();
    sanitizeCommentSortTopUI();

    const commentInput = document.getElementById('commentInput');
    if (commentInput) {
        if (isPromptCommentComposerEnabled()) {
            commentInput.setAttribute('placeholder', '');
        } else {
            commentInput.setAttribute('placeholder', window.i18n?.t('gallery.addComment') || 'Add a comment...');
        }
    }

    const sortLabel = document.getElementById('currentSortLabel');
    const sortType = localStorage.getItem('commentSortPreference') || 'newest';
    if (sortLabel) {
        const labels = getCommentSortLabels();
        sortLabel.textContent = labels[sortType] || labels.newest;
    }

    const list = document.getElementById('commentList');
    if (list?.querySelector('.comment-empty-state[data-state="empty"]')) {
        renderCommentEmptyState(list);
    }
}

// Initialize sorting on load
document.addEventListener('DOMContentLoaded', () => {
    setupCommentSorting();

    // Setup comment input listeners including iOS scroll stabiliser
    const commentInput = document.getElementById('commentInput');
    if (commentInput) {
        commentInput.addEventListener('keydown', handleCommentKeydown);
        commentInput.addEventListener('input', () => autoExpandTextarea(commentInput));

        if (isPromptCommentComposerEnabled()) {
            const commentInputArea = commentInput.closest('.comment-input-area');
            const uploadBtn = document.getElementById('commentUploadBtn');
            const sendBtn = document.getElementById('sendCommentBtn');
            const launchComposer = (e, options = {}) => {
                if (e?.cancelable) e.preventDefault();
                if (e) e.stopPropagation();
                openPromptCommentComposer({ focus: true, ...options });
            };

            ensurePromptCommentComposer();
            initCommentImageUpload();

            commentInputArea?.classList.add('composer-proxy');
            commentInput.setAttribute('readonly', 'readonly');
            commentInput.setAttribute('placeholder', '');
            updatePromptCommentComposerTriggerState();
            commentInput.addEventListener('touchstart', (e) => launchComposer(e), { passive: false });
            commentInput.addEventListener('click', (e) => launchComposer(e));
            commentInput.addEventListener('focus', () => {
                commentInput.blur();
                openPromptCommentComposer({ focus: true });
            });

            if (uploadBtn) {
                uploadBtn.addEventListener('click', (e) => launchComposer(e, { openFilePicker: true }));
            }

            if (sendBtn) {
                sendBtn.addEventListener('click', (e) => launchComposer(e));
            }
            window.i18n?.ready?.().then(() => refreshCommentLanguageUI());
            return;
        }

        document.getElementById('sendCommentBtn')?.addEventListener('click', () => {
            void submitComment();
        });

        // ── V18 Fix: Prevent iOS Safari from natively scrolling the page when tapping
        // the comment input. Without e.preventDefault() here, Safari fires a layout
        // scroll-to-input that fights the JS keyboard docking and causes visible jitter.
        const handleTouchFocus = (e) => {
            if (isPromptModalIOSMobile()) {
                // Only preventDefault on FIRST tap (when textarea not focused).
                // If already focused, allow native touch scrolling within textarea.
                if (document.activeElement !== commentInput) {
                    if (e.cancelable) e.preventDefault();

                    // Continuous scroll clamp to catch Safari's native scroll-to-input
                    const scrollClamp = () => {
                        if (window.scrollY !== 0 || window.scrollX !== 0) {
                            window.scrollTo(0, 0);
                        }
                    };
                    window.addEventListener('scroll', scrollClamp, { passive: true });
                    window.scrollTo(0, 0);

                    try {
                        commentInput.focus({ preventScroll: true });
                    } catch (err) {
                        commentInput.focus();
                    }

                    window.scrollTo(0, 0);

                    // Remove clamp after keyboard settles
                    setTimeout(() => {
                        window.removeEventListener('scroll', scrollClamp);
                        window.scrollTo(0, 0);
                    }, 400);
                }
                // else: textarea already focused, allow native scroll
            }
        };
        commentInput.addEventListener('touchstart', handleTouchFocus, { passive: false });

        commentInput.addEventListener('focus', () => {
            primePromptModalKeyboardDock();
        });

        commentInput.addEventListener('blur', () => {
            schedulePromptModalUndock();
        });
    }

    window.i18n?.ready?.().then(() => refreshCommentLanguageUI());
});

window.addEventListener('languageChanged', refreshCommentLanguageUI);

// Animation lock to prevent rapid click issues
let isModalImageAnimating = false;

function updateModalImage(index) {
    if (currentModalImages.length === 0) return;

    // Prevent rapid clicks from causing issues
    if (isModalImageAnimating) {
        console.log('⏳ Image transition in progress, ignoring click');
        return;
    }
    isModalImageAnimating = true;

    // Safety timeout: release lock after 5 seconds in case image never loads
    const safetyTimeout = setTimeout(() => {
        if (isModalImageAnimating) {
            console.warn('⚠️ Image load timeout, releasing animation lock');
            isModalImageAnimating = false;
        }
    }, 5000);

    currentModalImageIndex = index;

    const imgContainer = document.querySelector('.modal-image-col');
    const currentImg = document.getElementById('modalImg');

    // Remove any leftover transition images first
    const leftoverImages = imgContainer.querySelectorAll('.modal-next-image');
    leftoverImages.forEach(img => img.remove());

    // 1. Create new image (hidden)
    const newImg = document.createElement('img');
    newImg.src = currentModalImages[index];
    newImg.className = 'modal-next-image'; // Position absolute, opacity 0

    // Important: if in comment mode, new image also needs top:35% style? 
    // Handled by CSS selector .modal-inner.comment-mode .modal-image-col img

    // Insert after current image
    imgContainer.insertBefore(newImg, currentImg.nextSibling);

    // 2. Wait for load
    newImg.onload = () => {
        requestAnimationFrame(() => {
            // Simultaneously: fade IN new image, fade OUT old image
            newImg.classList.add('animate-in');
            currentImg.classList.add('animate-out'); // Add fade out to old image

            setTimeout(() => {
                // Clear safety timeout since load was successful
                clearTimeout(safetyTimeout);

                // Remove old image and clean up new one
                if (currentImg && currentImg.parentNode) {
                    currentImg.remove();
                }
                newImg.id = 'modalImg';
                newImg.classList.remove('modal-next-image', 'animate-in');
                newImg.className = 'active';

                // Release the lock
                isModalImageAnimating = false;
            }, 300); // Slightly faster cleanup
        });
    };

    // Fallback: release lock if image fails to load
    newImg.onerror = () => {
        console.warn('⚠️ Modal image failed to load, releasing lock');
        clearTimeout(safetyTimeout);
        isModalImageAnimating = false;
    };

    updateModalCounter();
}

function updateModalCounter() {
    const counter = document.getElementById('modalImgCounter');
    if (counter) {
        counter.textContent = `${currentModalImageIndex + 1} / ${currentModalImages.length}`;
    }
}

function navigateModalImage(direction) {
    if (currentModalImages.length <= 1) return;

    if (direction === 'next') {
        currentModalImageIndex = (currentModalImageIndex + 1) % currentModalImages.length;
    } else {
        currentModalImageIndex = (currentModalImageIndex - 1 + currentModalImages.length) % currentModalImages.length;
    }

    updateModalImage(currentModalImageIndex);
}

// --- Mobile Touch Swipe for Modal Images ---
(function initModalImageSwipe() {
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    document.addEventListener('touchstart', function (e) {
        const imgCol = e.target.closest('.modal-image-col');
        if (!imgCol || currentModalImages.length <= 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = true;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
        if (!isSwiping) return;
        const imgCol = e.target.closest('.modal-image-col');
        if (!imgCol) return;

        const dx = Math.abs(e.touches[0].clientX - touchStartX);
        const dy = Math.abs(e.touches[0].clientY - touchStartY);

        // If horizontal movement dominates, prevent vertical scroll
        if (dx > dy && dx > 10) {
            e.preventDefault();
        }
    }, { passive: false });

    document.addEventListener('touchend', function (e) {
        if (!isSwiping) return;
        isSwiping = false;

        const imgCol = e.target.closest('.modal-image-col');
        if (!imgCol || currentModalImages.length <= 1) return;

        const touchEndX = e.changedTouches[0].clientX;
        const deltaX = touchEndX - touchStartX;
        const SWIPE_THRESHOLD = 50;

        if (Math.abs(deltaX) >= SWIPE_THRESHOLD) {
            if (deltaX < 0) {
                navigateModalImage('next');  // 左滑 → 下一张
            } else {
                navigateModalImage('prev');  // 右滑 → 上一张
            }
        }
    }, { passive: true });
})();

function closePromptModal() {
    if (!runPromptModalCloseChromeCleanup()) {
        forceHidePromptModalDuringClose();
        clearPromptModalThemeColor({ restoreDelayMs: 320 });
    }
    hidePromptModalStatusBarShield({ immediate: true });
    closePromptCommentComposer({ clearDraft: true, preserveModalDock: true });
    setCommentSortDropdownOpen(false);

    // If closing while in comment mode, revert DOM first to prevent glitches next time
    if (isCommentMode) {
        // Simple revert without animation
        const promptArea = document.getElementById('promptArea');
        const contentCol = document.querySelector('.modal-content-col');
        const commentSection = document.getElementById('commentSection');
        if (promptArea && contentCol && promptArea.parentNode !== contentCol) {
            promptArea.classList.remove('docked');
            contentCol.insertBefore(promptArea, commentSection);
        }

        // Reset comment mode state
        isCommentMode = false;
        const modalInner = document.querySelector('#promptModal .modal-inner');
        releasePromptModalCommentModeGeometry();
        if (modalInner) modalInner.classList.remove('comment-mode');

        // Reset comment button
        const triggerBtn = document.getElementById('commentTriggerBtn');
        if (triggerBtn) {
            triggerBtn.classList.remove('active');
            const icon = triggerBtn.querySelector('i');
            if (icon) icon.className = 'fas fa-comment-dots';
        }
    }
    syncPromptModalTopButtonState();

    const modal = document.getElementById('promptModal');
    if (modal) {
        clearPromptModalOpeningTimer();
        modal.classList.add('closing'); // Instant Clip-Path detachment for Safari
        modal.classList.remove('modal-opening');
        modal.classList.remove('active');
    }

    const { backdrop } = getPromptModalDockNodes();
    if (backdrop) {
        // Non-iOS browsers keep the normal fade; iOS gets force-hidden above.
        backdrop.classList.add('closing');
        backdrop.classList.remove('visible');
    }

    detachPromptModalKeyboardDock();
    restorePromptModalOverlay();

    // Give non-iOS CSS time to fade out, then clean up the DOM and unlock scroll.
    clearPromptModalCloseCleanupTimer();
    promptModalCloseCleanupTimer = setTimeout(() => {
        promptModalCloseCleanupTimer = null;
        if (modal?.classList.contains('active')) return;
        if (backdrop) backdrop.classList.remove('closing');
        if (modal) modal.classList.remove('closing');

        if (window.iOSScrollLock) window.iOSScrollLock.unlock();
        // Remove manual overflow:hidden added in openPromptModal for iOS
        setPromptsPageOverflow('');
        document.body.classList.remove('prompt-modal-keyboard-docked');
        document.body.classList.remove('modal-open');
        promptModalBaseScrollY = 0;

        hidePromptModalStatusBarShield();

        // Physically detach modal from Safe Area render tree, skipping layout breakage of `visibility`
        if (modal) modal.classList.remove('poetry-modal--visible');

        // Force Safari iOS 15+ to acknowledge the detached modal by micro-tickling the theme color layer
        forceSafariSafeAreaJiggle();
    }, 180);
}

// Click outside modal to close
document.addEventListener('click', function (e) {
    const modal = document.getElementById('promptModal');
    if (!modal || !modal.classList.contains('active')) return;

    // ── Fix: Prevent stray clicks from closing modal during keyboard dock animation ──
    if (promptModalKeyboardDock?.animatingUntil > Date.now()) return;

    // Only close if clicking the backdrop itself, not the inner content
    if (e.target === modal) {
        closePromptModal();
    }
});
