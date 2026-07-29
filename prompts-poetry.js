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

const PROMPTS_NON_SELECTABLE_UI_SELECTOR = [
    '.framer-nav',
    '.mobile-menu',
    '.nav-dropdown',
    '.nav-dropdown-portal',
    '.sort-trigger',
    '.sort-dropdown',
    '.sort-option'
].join(', ');

function isSupabaseStorageImageUrl(url) {
    return /^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i.test(String(url || '').trim());
}

function disablePromptImageDrag(image) {
    if (!image || typeof image.setAttribute !== 'function') return;
    image.setAttribute('draggable', 'false');
    image.draggable = false;
}

function preventPromptImageDrag(event) {
    const target = event?.target instanceof Element
        ? event.target.closest('img')
        : null;
    if (target) {
        event.preventDefault();
    }
}

function preventPromptCardTextSelection(event) {
    if (!(event?.target instanceof Element)) return;

    const cardTarget = event.target.closest('.prompt-card');
    const uiTarget = event.target.closest(PROMPTS_NON_SELECTABLE_UI_SELECTOR);
    if (cardTarget || uiTarget) {
        event.preventDefault();
    }
}

function bindPromptImageDragLock() {
    document.addEventListener('dragstart', preventPromptImageDrag);
    document.addEventListener('selectstart', preventPromptCardTextSelection);
    document.querySelectorAll('img').forEach(disablePromptImageDrag);
}

const PROMPT_IMAGE_ASSET_KEYS = Object.freeze(['original', 'thumb', 'featured', 'card', 'home']);
const PROMPT_IMAGE_CDN_VARIANT_PATHS = new Set(['thumb', 'featured', 'card', 'home']);

function getPromptAssetCdnOrigin({ canonical = false } = {}) {
    if (canonical) {
        return String(window.SiteConfig?.getCanonicalAssetCdnOrigin?.() || 'https://cdn.fatherkey.com').replace(/\/+$/, '');
    }

    const configuredOrigin = String(window.SiteConfig?.getAssetCdnOrigin?.() || '').trim();
    if (configuredOrigin) {
        return configuredOrigin.replace(/\/+$/, '');
    }

    const hostname = String(window.location?.hostname || '').toLowerCase();
    return hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz')
        ? 'https://cdn.zaoyoe.xyz'
        : 'https://cdn.fatherkey.com';
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
        const isKnownCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname) || parsed.hostname.endsWith('.r2.dev');
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
        if (!['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)) return '';

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
    } catch (error) {
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
    } catch (error) {
        return trimmed;
    }

    return getPromptImageCanonicalOriginalUrl(trimmed) || trimmed;
}

function assignPromptImageAssetUrl(asset, key, url) {
    const safeUrl = String(url || '').trim();
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

function getPromptImageAssetPositiveNumber(...values) {
    for (const value of values) {
        const numberValue = Number(value);
        if (Number.isFinite(numberValue) && numberValue > 0) {
            return numberValue;
        }
    }
    return 0;
}

function assignPromptImageAssetDimensions(asset, value = {}) {
    if (!asset || !value || typeof value !== 'object' || Array.isArray(value)) return;

    const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
        ? value.metadata
        : {};
    const original = value.original && typeof value.original === 'object' && !Array.isArray(value.original)
        ? value.original
        : {};

    const width = getPromptImageAssetPositiveNumber(
        value.width,
        value.w,
        value.originalWidth,
        value.original_width,
        value.naturalWidth,
        value.natural_width,
        metadata.width,
        metadata.w,
        metadata.originalWidth,
        metadata.original_width,
        original.width,
        original.w
    );
    const height = getPromptImageAssetPositiveNumber(
        value.height,
        value.h,
        value.originalHeight,
        value.original_height,
        value.naturalHeight,
        value.natural_height,
        metadata.height,
        metadata.h,
        metadata.originalHeight,
        metadata.original_height,
        original.height,
        original.h
    );

    if (width && height) {
        asset.width = width;
        asset.height = height;
    }
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

    assignPromptImageAssetDimensions(asset, value);

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
    const seen = new Map();

    for (const source of [...explicitAssets, ...legacyImages]) {
        const asset = normalizePromptImageAsset(source);
        if (!asset) continue;

        const key = getPromptImageCanonicalDedupeKey(getPromptImageAssetOriginalUrl(asset));
        if (!key) continue;
        if (seen.has(key)) {
            const existing = seen.get(key);
            existing.original = asset.original || existing.original;
            existing.width = existing.width || asset.width;
            existing.height = existing.height || asset.height;
            for (const assetKey of PROMPT_IMAGE_ASSET_KEYS) {
                if (!existing[assetKey] && asset[assetKey]) {
                    existing[assetKey] = asset[assetKey];
                }
            }
            continue;
        }

        seen.set(key, asset);
        assets.push(asset);
    }

    return assets;
}

function getPromptImageAssets(item = {}) {
    return normalizePromptImageAssetsFromRecord(item);
}

function normalizePromptImagePalettesFromRecord(record = {}) {
    const source = Array.isArray(record?.imagePalettes)
        ? record.imagePalettes
        : (Array.isArray(record?.image_palettes) ? record.image_palettes : []);

    return source.flatMap((palette) => {
        if (!palette || typeof palette !== 'object' || Array.isArray(palette)) return [];
        const colors = (Array.isArray(palette.colors) ? palette.colors : []).flatMap((color) => {
            const hex = String(color?.hex || '').trim().toUpperCase();
            if (!/^#[0-9A-F]{6}$/.test(hex)) return [];
            const ratio = Number(color?.ratio);
            return [{ hex, ratio: Number.isFinite(ratio) && ratio >= 0 ? ratio : 0 }];
        }).slice(0, 6);
        if (!colors.length) return [];

        return [{
            image_index: Math.max(0, Number.parseInt(palette.image_index ?? palette.imageIndex, 10) || 0),
            image_url: String(palette.image_url || palette.imageUrl || '').trim(),
            image_hash: String(palette.image_hash || palette.imageHash || '').trim(),
            version: Number.parseInt(palette.version, 10) || 0,
            colors
        }];
    });
}

function normalizePromptVideoAsset(value) {
    const source = typeof value === 'string' ? { original: value } : value;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const original = String(source.original || source.url || source.src || '').trim();
    if (!original || isSupabaseStorageImageUrl(original)) return null;
    const posterAsset = normalizePromptImageAsset(
        source.poster_asset
        || source.posterAsset
        || source.poster
        || source.poster_url
        || source.posterUrl
        || null
    );
    const poster = getPromptImageAssetOriginalUrl(posterAsset)
        || String(source.poster || source.poster_url || source.posterUrl || '').trim();
    return {
        original,
        poster,
        posterAsset,
        mimeType: String(source.mime_type || source.mimeType || source.type || 'video/mp4').trim(),
        width: Number(source.width || 0) || 0,
        height: Number(source.height || 0) || 0,
        duration: Number(source.duration || 0) || 0
    };
}

function getPromptVideoAssets(item = {}) {
    const source = Array.isArray(item?.videoAssets)
        ? item.videoAssets
        : (Array.isArray(item?.video_assets) ? item.video_assets : []);
    const seen = new Set();
    return source.map(normalizePromptVideoAsset).filter((asset) => {
        const key = String(asset?.original || '').toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getPromptImageAssetAspectRatio(value) {
    const asset = normalizePromptImageAsset(value);
    if (!asset) return 0;

    const width = getPromptImageAssetPositiveNumber(asset.width);
    const height = getPromptImageAssetPositiveNumber(asset.height);
    if (!width || !height) return 0;
    return width / height;
}

function formatPromptImageAspectRatio(aspectRatio) {
    const ratio = Number(aspectRatio);
    if (!Number.isFinite(ratio) || ratio <= 0) return '';
    return String(Math.round(ratio * 10000) / 10000);
}

function applyPromptCardImageAspectRatio(card, aspectRatio) {
    if (!card) return 0;

    const formattedRatio = formatPromptImageAspectRatio(aspectRatio);
    if (!formattedRatio) return 0;

    card.dataset.imageAspectRatio = formattedRatio;
    setPromptsCssVars(card, {
        '--prompt-card-masonry-aspect-ratio': formattedRatio
    });
    return Number(formattedRatio);
}

function applyPromptCardImageAssetAspectRatio(card, imageAsset) {
    return applyPromptCardImageAspectRatio(card, getPromptImageAssetAspectRatio(imageAsset));
}

function applyPromptCardNaturalImageAspectRatio(card, cardImage) {
    if (!card || !cardImage?.naturalWidth || !cardImage?.naturalHeight) return 0;
    return applyPromptCardImageAspectRatio(card, cardImage.naturalWidth / cardImage.naturalHeight);
}

function getPromptPrimaryImageAsset(item = {}) {
    const videoAsset = getPromptVideoAssets(item)[0];
    const posterAsset = videoAsset?.posterAsset || normalizePromptImageAsset(videoAsset?.poster);
    return posterAsset || getPromptImageAssets(item)[0] || null;
}

function getPromptModalImageUrl(url) {
    const trimmed = getPromptImageAssetOriginalUrl(url);
    if (!trimmed) return '';
    if (isSupabaseStorageImageUrl(trimmed)) return '';
    const displayUrl = normalizePromptCdnUrlForCurrentSite(trimmed) || trimmed;

    try {
        const parsed = new URL(displayUrl, window.location.origin);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);

        const isPromptCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname) || parsed.hostname.endsWith('.r2.dev');
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

function getPromptModalThumbnailUrl(value) {
    return getPromptModalImageUrl(value);
}

function getPromptModalImageEntries(item = {}) {
    return getPromptImageAssets(item)
        .map((asset) => {
            const imageUrl = getPromptModalImageUrl(asset);
            if (!imageUrl) return null;
            return {
                imageUrl,
                thumbUrl: getPromptModalThumbnailUrl(asset) || imageUrl
            };
        })
        .filter(Boolean);
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

function getPromptActionCopy(key, zhFallback, enFallback) {
    const fallback = getCurrentLanguage() === 'en' ? enFallback : zhFallback;
    return window.i18n?.t?.(`gallery.${key}`) || fallback;
}

function getPromptFavoriteActionLabel(isSaved = false) {
    return isSaved
        ? getPromptActionCopy('unsavePrompt', '取消收藏', 'Unsave')
        : getPromptActionCopy('savePrompt', '收藏', 'Save');
}

function getPromptSourceActionLabel() {
    return getPromptActionCopy('viewOriginalAuthor', '去看原作者', 'View original author');
}

function getPromptRelatedActionLabel() {
    return getPromptActionCopy('viewSameStylePrompts', '相同风格', 'Same style');
}

function getPromptShareActionLabel() {
    return getPromptActionCopy('sharePrompt', '分享', 'Share');
}

function getPromptShareCopiedLabel() {
    return getPromptActionCopy('promptShareCopied', '分享链接已复制', 'Share link copied');
}

function getPromptShareCopyFailedLabel() {
    return getPromptActionCopy('promptShareCopyFailed', '复制失败，请重试', 'Copy failed, please try again');
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
    const canonicalValue = String(item[field] || '').trim();

    // Priority 1: Try current language field
    if (item[localizedKey] && item[localizedKey].trim()) {
        if (field === 'prompt_text'
            && window.FatherKeyPromptMediaTabs?.shouldUseFallbackPromptText?.(item[localizedKey], canonicalValue)) {
            return resolvePromptLocalizedDataText(canonicalValue, field);
        }
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
function showGalleryToast(message, type = 'warning', duration = 3000, compact = false) {
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
    toast.className = `gallery-toast gallery-toast--${type}${compact ? ' gallery-toast--compact' : ''}`;
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

// Inverted search index for O(1) tag lookups (warmed in idle chunks)
// Structure: { "tag_lowercase": [promptIndex1, promptIndex2, ...] }
let SEARCH_INDEX = null;
let SEARCH_INDEX_PROMPTS_REF = null;
let SEARCH_INDEX_PROMPTS_LENGTH = 0;
let SEARCH_INDEX_GENERATION = 0;
let SEARCH_INDEX_WARM_PROMISE = null;
let PROMPT_SEARCH_REQUEST_ID = 0;
const PROMPT_IDLE_CHUNK_BUDGET_MS = 8;
const PROMPT_SEARCH_INDEX_CHUNK_SIZE = 6;
const PROMPT_RELATED_PROFILE_CHUNK_SIZE = 2;

function getPromptWorkNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function waitForPromptIdleChunk(timeoutMs = 120) {
    return new Promise((resolve) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(resolve, { timeout: timeoutMs });
            return;
        }
        window.setTimeout(() => resolve(null), 0);
    });
}

function shouldYieldPromptWork(deadline, startedAt, processedCount, maxItems) {
    if (processedCount >= maxItems) return true;
    if (getPromptWorkNow() - startedAt >= PROMPT_IDLE_CHUNK_BUDGET_MS) return true;
    return Boolean(deadline && !deadline.didTimeout && deadline.timeRemaining() <= 2);
}

function appendPromptToSearchIndex(targetIndex, prompt, index) {
    if (!prompt) return;
    const searchId = prompt.id ?? index;
    const addToIndex = (term) => {
        const key = normalizePromptSearchText(term);
        if (!hasPromptSearchSignal(key)) return;
        if (!targetIndex[key]) targetIndex[key] = [];
        if (!targetIndex[key].includes(searchId)) {
            targetIndex[key].push(searchId);
        }
    };

    collectPromptSearchValues({
        title: prompt.title,
        title_en: prompt.title_en,
        title_zh: prompt.title_zh,
        tags: prompt.tags,
        aiTags: prompt.aiTags || prompt.ai_tags,
        dominantColors: prompt.dominantColors || prompt.dominant_colors
    }).forEach((value) => {
        getPromptSearchTokenVariants(value).forEach(addToIndex);
    });
}

function invalidatePromptSearchCaches() {
    SEARCH_INDEX = null;
    SEARCH_INDEX_PROMPTS_REF = null;
    SEARCH_INDEX_PROMPTS_LENGTH = 0;
    SEARCH_INDEX_GENERATION += 1;
    SEARCH_INDEX_WARM_PROMISE = null;
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
    const nextIndex = {};
    PROMPTS.forEach((prompt, index) => appendPromptToSearchIndex(nextIndex, prompt, index));

    SEARCH_INDEX = nextIndex;
    SEARCH_INDEX_PROMPTS_REF = PROMPTS;
    SEARCH_INDEX_PROMPTS_LENGTH = PROMPTS.length;
    console.log(`✅ Search index built: ${Object.keys(SEARCH_INDEX).length} terms`);
}

function buildSearchIndexIncrementally() {
    if (SEARCH_INDEX && SEARCH_INDEX_PROMPTS_REF === PROMPTS && SEARCH_INDEX_PROMPTS_LENGTH === PROMPTS.length) {
        return Promise.resolve(true);
    }
    if (SEARCH_INDEX_WARM_PROMISE) return SEARCH_INDEX_WARM_PROMISE;
    if (typeof PROMPTS === 'undefined' || PROMPTS.length === 0) return Promise.resolve(false);

    const sourcePrompts = PROMPTS;
    const sourceLength = sourcePrompts.length;
    const sourceGeneration = SEARCH_INDEX_GENERATION;
    const nextIndex = {};
    let cursor = 0;

    const warmPromise = (async () => {
        console.log('🔍 Building search index in idle chunks...');
        while (cursor < sourceLength) {
            const deadline = await waitForPromptIdleChunk();
            const startedAt = getPromptWorkNow();
            let processedCount = 0;

            while (cursor < sourceLength) {
                appendPromptToSearchIndex(nextIndex, sourcePrompts[cursor], cursor);
                cursor += 1;
                processedCount += 1;
                if (shouldYieldPromptWork(deadline, startedAt, processedCount, PROMPT_SEARCH_INDEX_CHUNK_SIZE)) break;
            }

            if (PROMPTS !== sourcePrompts || PROMPTS.length !== sourceLength || SEARCH_INDEX_GENERATION !== sourceGeneration) {
                return false;
            }
        }

        SEARCH_INDEX = nextIndex;
        SEARCH_INDEX_PROMPTS_REF = sourcePrompts;
        SEARCH_INDEX_PROMPTS_LENGTH = sourceLength;
        console.log(`✅ Search index built: ${Object.keys(nextIndex).length} terms`);
        return true;
    })();

    SEARCH_INDEX_WARM_PROMISE = warmPromise;
    const clearWarmPromise = () => {
        if (SEARCH_INDEX_WARM_PROMISE === warmPromise) {
            SEARCH_INDEX_WARM_PROMISE = null;
        }
    };
    void warmPromise.then(clearWarmPromise, clearWarmPromise);
    return warmPromise;
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
    if (!window.supabaseClient) {
        setPromptFavoriteAuthUser(null);
        return;
    }

    try {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        setPromptFavoriteAuthUser(user || null);

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
                disablePromptImageDrag(img);
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
        setPromptFavoriteAuthUser(null);
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
const PROMPT_GALLERY_SKELETON_COUNT = 6;
const PROMPT_NAV_SKELETON_COUNT = 8;
const PROMPT_NAV_FONT_WAIT_TIMEOUT_MS = 1400;
const PROMPT_NAV_SKELETON_ITEMS = [
    ['All', '全部'],
    ['Photography', '摄影'],
    ['Creative', '创意'],
    ['Illustration', '插画'],
    ['3D Art', '3D艺术'],
    ['Miniature', '微缩'],
    ['Animation', '动画'],
    ['Saved', '收藏']
];
let promptNavFontReadyPromise = null;
const PROMPT_GALLERY_EAGER_IMAGE_COUNT = 4;
const PROMPT_GALLERY_INITIAL_RENDER_MAX_COUNT = 20;
const PROMPT_GALLERY_IMAGE_ACTIVATION_MARGIN_PX = 360;
const PROMPT_GALLERY_IMAGE_ACTIVATION_CHUNK_SIZE = 2;
const PROMPT_GALLERY_IMAGE_ACTIVATION_INTERVAL_MS = 80;
const PROMPT_GALLERY_MOBILE_MASONRY_QUERY = '(max-width: 768px)';
const PROMPT_GALLERY_MASONRY_MIN_COLUMN_WIDTH_PX = 280;
const PROMPT_GALLERY_MASONRY_MAX_COLUMN_COUNT = 5;
const PROMPT_GALLERY_MOBILE_MASONRY_COLUMN_COUNT = 2;
const PROMPT_GALLERY_MASONRY_CARD_LAYOUTS = [
    { className: 'prompt-card--mobile-hero', aspectRatio: 0.66, heightWeight: 1.52 },
    { className: 'prompt-card--mobile-wide', aspectRatio: 1.28, heightWeight: 0.78 },
    { className: 'prompt-card--mobile-portrait', aspectRatio: 0.78, heightWeight: 1.28 },
    { className: 'prompt-card--mobile-square', aspectRatio: 1, heightWeight: 1 }
];
const PROMPT_GALLERY_MASONRY_LAYOUT_CLASS_NAMES = PROMPT_GALLERY_MASONRY_CARD_LAYOUTS.map((layout) => layout.className);
const PROMPT_GALLERY_MASONRY_CARD_GAP_WEIGHT = 0.12;
const PROMPT_GALLERY_MASONRY_RESIZE_DEBOUNCE_MS = 520;
const PROMPT_GALLERY_RESIZE_PRELOAD_IDLE_MS = 620;
const PROMPT_GALLERY_RESIZE_LIGHT_MODE_MS = 680;
const PROMPT_GALLERY_RESIZE_LIGHT_MODE_CLASS = 'prompt-gallery-resizing';
const PROMPT_SUPABASE_CLIENT_READY_TIMEOUT_MS = 12000;
const PROMPT_SUPABASE_RETRY_DELAY_MS = 2800;
const promptGalleryImageWarmCache = new Set();
const promptGalleryDeferredImageAssets = new WeakMap();
const promptGalleryPendingImageActivations = new Set();
let promptGalleryCardImageObserver = null;
let promptGalleryImageActivationTimerId = null;
let promptGalleryMasonrySignature = null;
let promptGalleryMasonryResizeTimerId = null;
let promptGalleryResizeLightModeTimerId = null;
let promptGalleryMasonryHeightSyncFrameId = null;

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
    'image_palettes',
    'video_assets',
    'dominant_colors',
    'ai_tags',
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url',
    'created_at'
].join(',');
const PROMPTS_SOURCE_ATTRIBUTION_FIELD_KEYS = [
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url'
];
const PROMPTS_SUPABASE_SUMMARY_LEGACY_SELECT = PROMPTS_SUPABASE_SUMMARY_SELECT
    .split(',')
    .filter((field) => !['image_assets', 'image_palettes', 'video_assets'].includes(field) && !PROMPTS_SOURCE_ATTRIBUTION_FIELD_KEYS.includes(field))
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
    'image_palettes',
    'video_assets',
    'dominant_colors',
    'ai_tags',
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url'
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
    'ai_tags',
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url'
].join(',');
const PROMPTS_SUPABASE_DETAIL_LEGACY_SELECT = PROMPTS_SUPABASE_DETAIL_SELECT
    .split(',')
    .filter((field) => !['image_assets', 'image_palettes', 'video_assets'].includes(field) && !PROMPTS_SOURCE_ATTRIBUTION_FIELD_KEYS.includes(field))
    .join(',');
const PROMPTS_SUPABASE_SEARCH_DETAIL_LEGACY_SELECT = PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT
    .split(',')
    .filter((field) => !PROMPTS_SOURCE_ATTRIBUTION_FIELD_KEYS.includes(field))
    .join(',');
let staticPromptDetailPromise = null;
let promptSearchDetailHydrationPromise = null;
let promptSearchDetailsHydrated = false;
const promptDetailLoadPromises = new Map();
let promptPageInitialRenderStarted = false;
let promptLiveDataRetryTimer = null;

function isMissingPromptImageAssetsColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return Boolean(message && (
        message.includes('image_assets')
        || message.includes('image_palettes')
        || message.includes('video_assets')
        || PROMPTS_SOURCE_ATTRIBUTION_FIELD_KEYS.some((field) => message.includes(field))
        || message.includes('column of "prompts"')
        || message.includes("column of 'prompts'")
    ));
}

function replacePromptDataset(nextPrompts = []) {
    const visiblePrompts = filterVisiblePromptsForPromptsPage(nextPrompts).map((prompt, index) => ({
        ...prompt,
        id: index,
        supabaseId: prompt?.supabaseId || prompt?.supabase_id || prompt?.id || null,
        supabase_id: prompt?.supabase_id || prompt?.supabaseId || prompt?.id || null
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
    const imagePalettes = normalizePromptImagePalettesFromRecord(item);
    const videoAssets = (Array.isArray(item?.video_assets) || Array.isArray(item?.videoAssets))
        ? getPromptVideoAssets(item)
        : [];
    return {
        id: index,
        supabaseId: item.id,
        supabase_id: item.id,
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
        imagePalettes,
        image_palettes: imagePalettes,
        videoAssets,
        video_assets: videoAssets,
        dominantColors: Array.isArray(item.dominant_colors) ? item.dominant_colors : [],
        aiTags: item.ai_tags || {},
        sourceUrl: item.source_url || '',
        source_url: item.source_url || '',
        sourceAuthorName: item.source_author_name || '',
        source_author_name: item.source_author_name || '',
        sourceAuthorHandle: item.source_author_handle || '',
        source_author_handle: item.source_author_handle || '',
        sourceAuthorAvatarUrl: item.source_author_avatar_url || '',
        source_author_avatar_url: item.source_author_avatar_url || '',
        createdAt: item.created_at || '',
        hasPromptDetail: true,
        promptSummaryOnly: true,
        detailSource: 'supabase'
    };
}

function normalizeSupabasePromptDetail(item = {}) {
    const imageAssets = normalizePromptImageAssetsFromRecord(item);
    const videoAssets = (Array.isArray(item?.video_assets) || Array.isArray(item?.videoAssets))
        ? getPromptVideoAssets(item)
        : [];
    return {
        supabaseId: item.id,
        supabase_id: item.id,
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
        imagePalettes: normalizePromptImagePalettesFromRecord(item),
        image_palettes: normalizePromptImagePalettesFromRecord(item),
        videoAssets,
        video_assets: videoAssets,
        dominantColors: Array.isArray(item.dominant_colors) ? item.dominant_colors : [],
        aiTags: item.ai_tags || {},
        sourceUrl: item.source_url || '',
        source_url: item.source_url || '',
        sourceAuthorName: item.source_author_name || '',
        source_author_name: item.source_author_name || '',
        sourceAuthorHandle: item.source_author_handle || '',
        source_author_handle: item.source_author_handle || '',
        sourceAuthorAvatarUrl: item.source_author_avatar_url || '',
        source_author_avatar_url: item.source_author_avatar_url || '',
        hasPromptDetail: true,
        promptSummaryOnly: false,
        promptDetailLoaded: true,
        detailSource: 'supabase'
    };
}

function normalizeSupabasePromptSearchDetail(item = {}) {
    return {
        supabaseId: item.id,
        supabase_id: item.id,
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
        sourceUrl: item.source_url || '',
        source_url: item.source_url || '',
        sourceAuthorName: item.source_author_name || '',
        source_author_name: item.source_author_name || '',
        sourceAuthorHandle: item.source_author_handle || '',
        source_author_handle: item.source_author_handle || '',
        sourceAuthorAvatarUrl: item.source_author_avatar_url || '',
        source_author_avatar_url: item.source_author_avatar_url || '',
        hasPromptDetail: true,
        promptSummaryOnly: false,
        promptDetailLoaded: true,
        detailSource: 'supabase'
    };
}

function getPromptDetailLookupKeys(item = {}) {
    return [
        item?.supabaseId,
        item?.supabase_id,
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

function getPromptStableOpenId(item = {}) {
    return String(
        item?.supabaseId
        ?? item?.supabase_id
        ?? item?.prompt_id
        ?? item?.id
        ?? ''
    ).trim();
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
        imagePalettes: normalizePromptImagePalettesFromRecord(detail).length > 0
            ? normalizePromptImagePalettesFromRecord(detail)
            : normalizePromptImagePalettesFromRecord(item),
        image_palettes: normalizePromptImagePalettesFromRecord(detail).length > 0
            ? normalizePromptImagePalettesFromRecord(detail)
            : normalizePromptImagePalettesFromRecord(item),
        videoAssets: getPromptVideoAssets(detail).length > 0 ? getPromptVideoAssets(detail) : getPromptVideoAssets(item),
        video_assets: getPromptVideoAssets(detail).length > 0 ? getPromptVideoAssets(detail) : getPromptVideoAssets(item),
        dominantColors: Array.isArray(detail.dominantColors) ? detail.dominantColors : (item.dominantColors || []),
        aiTags: detail.aiTags || item.aiTags || {},
        sourceUrl: detail.sourceUrl || detail.source_url || item.sourceUrl || item.source_url || '',
        source_url: detail.source_url || detail.sourceUrl || item.source_url || item.sourceUrl || '',
        sourceAuthorName: detail.sourceAuthorName || detail.source_author_name || item.sourceAuthorName || item.source_author_name || '',
        source_author_name: detail.source_author_name || detail.sourceAuthorName || item.source_author_name || item.sourceAuthorName || '',
        sourceAuthorHandle: detail.sourceAuthorHandle || detail.source_author_handle || item.sourceAuthorHandle || item.source_author_handle || '',
        source_author_handle: detail.source_author_handle || detail.sourceAuthorHandle || item.source_author_handle || item.sourceAuthorHandle || '',
        sourceAuthorAvatarUrl: detail.sourceAuthorAvatarUrl || detail.source_author_avatar_url || item.sourceAuthorAvatarUrl || item.source_author_avatar_url || '',
        source_author_avatar_url: detail.source_author_avatar_url || detail.sourceAuthorAvatarUrl || item.source_author_avatar_url || item.sourceAuthorAvatarUrl || '',
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

    let { data, error } = await window.supabaseClient
        .from('prompts')
        .select(PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT)
        .in('id', ids);

    if (error && isMissingPromptImageAssetsColumnError(error)) {
        const fallbackResult = await window.supabaseClient
            .from('prompts')
            .select(PROMPTS_SUPABASE_SEARCH_DETAIL_LEGACY_SELECT)
            .in('id', ids);
        data = fallbackResult.data;
        error = fallbackResult.error;
    }

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

async function loadPromptsFromSupabase(options = {}) {
    const clientReadyTimeoutMs = Number.isFinite(options.clientReadyTimeoutMs)
        ? options.clientReadyTimeoutMs
        : PROMPT_SUPABASE_CLIENT_READY_TIMEOUT_MS;

    if (!window.supabaseClient) {
        const runtimeReady = await waitForPromptSupabaseClientReady(clientReadyTimeoutMs);
        if (!runtimeReady || !window.supabaseClient) {
            console.warn('Supabase client not available; keeping prompt gallery loading instead of showing static snapshots');
            replacePromptDataset([]);
            return false;
        }
    }

    if (!window.supabaseClient) {
        console.warn('Supabase client not available; keeping prompt gallery loading instead of showing static snapshots');
        replacePromptDataset([]);
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
            replacePromptDataset([]);
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

        replacePromptDataset([]);
        console.log('Loaded 0 visible prompts from Supabase');
        return true;
    } catch (err) {
        console.error('Error loading from Supabase:', err);
        replacePromptDataset([]);
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
    const safeCount = Math.min(Math.max(Number.parseInt(count, 10) || PROMPT_NAV_SKELETON_COUNT, 6), 10);

    return Array.from({ length: safeCount }, (_, index) => {
        const [englishLabel, chineseLabel] = PROMPT_NAV_SKELETON_ITEMS[index % PROMPT_NAV_SKELETON_ITEMS.length];
        return `
            <div class="nav-item nav-item--skeleton" aria-hidden="true" data-nav-skeleton-index="${index}">
                <span class="en skeleton nav-item-skeleton nav-item-skeleton--title">${englishLabel}</span>
                <span class="cn skeleton nav-item-skeleton nav-item-skeleton--subtitle">${chineseLabel}</span>
            </div>
        `;
    }).join('');
}

function waitForPromptNavFont() {
    if (promptNavFontReadyPromise) return promptNavFontReadyPromise;
    if (!document.fonts?.load) {
        promptNavFontReadyPromise = Promise.resolve();
        return promptNavFontReadyPromise;
    }

    const fontLoadPromise = document.fonts
        .load('400 1.4rem "Playfair Display"', 'Photography')
        .catch(() => []);
    const timeoutPromise = new Promise((resolve) => {
        window.setTimeout(resolve, PROMPT_NAV_FONT_WAIT_TIMEOUT_MS);
    });
    promptNavFontReadyPromise = Promise.race([fontLoadPromise, timeoutPromise]).then(() => undefined);
    return promptNavFontReadyPromise;
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

function isPromptGalleryMobileMasonryLayout() {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
        return window.matchMedia(PROMPT_GALLERY_MOBILE_MASONRY_QUERY).matches;
    }
    return (window.innerWidth || document.documentElement?.clientWidth || 0) <= 768;
}

function getPromptGalleryMasonryColumnCount(grid = null) {
    if (isPromptGalleryMobileMasonryLayout()) {
        return PROMPT_GALLERY_MOBILE_MASONRY_COLUMN_COUNT;
    }

    const galleryWidth = Math.max(
        0,
        Math.round(
            grid?.clientWidth
            || grid?.getBoundingClientRect?.().width
            || window.innerWidth
            || document.documentElement?.clientWidth
            || 0
        )
    );
    const minColumnWidth = PROMPT_GALLERY_MASONRY_MIN_COLUMN_WIDTH_PX;
    const gap = 24;
    const estimatedCount = Math.floor((galleryWidth + gap) / (minColumnWidth + gap));

    return Math.min(
        PROMPT_GALLERY_MASONRY_MAX_COLUMN_COUNT,
        Math.max(PROMPT_GALLERY_MOBILE_MASONRY_COLUMN_COUNT, estimatedCount || PROMPT_GALLERY_MOBILE_MASONRY_COLUMN_COUNT)
    );
}

function getPromptGalleryMasonrySignature(grid = null) {
    return `${isPromptGalleryMobileMasonryLayout() ? 'mobile' : 'desktop'}:${getPromptGalleryMasonryColumnCount(grid)}`;
}

function getPromptGalleryMasonryCardLayout(index = 0) {
    const safeIndex = Math.max(0, Number.parseInt(index, 10) || 0);
    return PROMPT_GALLERY_MASONRY_CARD_LAYOUTS[safeIndex % PROMPT_GALLERY_MASONRY_CARD_LAYOUTS.length]
        || PROMPT_GALLERY_MASONRY_CARD_LAYOUTS[0];
}

function getPromptGalleryMasonryCardAspectWeight(card, index = 0) {
    const imageAspectRatio = Number.parseFloat(card?.dataset?.imageAspectRatio || '');
    if (Number.isFinite(imageAspectRatio) && imageAspectRatio > 0) {
        return 1 / imageAspectRatio;
    }
    return getPromptGalleryMasonryCardLayout(index).heightWeight;
}

function getPromptGalleryMasonryTargetColumnIndex(columnHeights = []) {
    if (!columnHeights.length) return 0;
    return columnHeights.reduce((targetIndex, height, index) => (
        height < columnHeights[targetIndex] ? index : targetIndex
    ), 0);
}

function applyPromptGalleryMasonryCardLayout(card, index = 0) {
    if (!card) return;
    card.classList.remove(...PROMPT_GALLERY_MASONRY_LAYOUT_CLASS_NAMES);
    const layout = getPromptGalleryMasonryCardLayout(index);
    card.classList.add(layout.className);
    setPromptsCssVars(card, {
        '--prompt-card-masonry-fallback-aspect-ratio': layout.aspectRatio
    });
}

function createPromptGalleryMasonryState(grid) {
    if (!grid) return null;

    const isMobileMasonry = isPromptGalleryMobileMasonryLayout();
    const columnCount = getPromptGalleryMasonryColumnCount(grid);

    grid.classList.remove('gallery-container--standard', 'gallery-container--initial-skeleton');
    grid.removeAttribute('data-initial-prompt-skeleton');
    grid.classList.add('gallery-container--masonry');
    grid.classList.toggle('gallery-container--mobile-masonry', isMobileMasonry);
    grid.classList.toggle('gallery-container--desktop-masonry', !isMobileMasonry);
    grid.innerHTML = Array.from({ length: columnCount }, (_, index) => {
        const positionClass = index === 0
            ? 'prompt-gallery-column--left'
            : (index === 1 ? 'prompt-gallery-column--right' : 'prompt-gallery-column--middle');
        return `<div class="prompt-gallery-column ${positionClass}" data-gallery-column="${index}"></div>`;
    }).join('');

    return {
        columns: Array.from(grid.querySelectorAll('.prompt-gallery-column')),
        columnHeights: Array.from({ length: columnCount }, () => 0),
        gapWeight: PROMPT_GALLERY_MASONRY_CARD_GAP_WEIGHT,
        columnCount
    };
}

function syncPromptGalleryMasonryColumnHeights(masonryState = promptGalleryMasonryState) {
    if (!masonryState?.columns?.length) return;

    const grid = masonryState.columns[0]?.parentElement;
    const gridStyle = grid ? window.getComputedStyle(grid) : null;
    const gapPx = Math.max(0, Number.parseFloat(gridStyle?.rowGap || gridStyle?.gap || '10') || 10);
    let totalColumnWidth = 0;

    masonryState.columnHeights = masonryState.columns.map((column) => {
        const columnWidth = Math.max(1, column.clientWidth || 1);
        totalColumnWidth += columnWidth;
        return Math.max(0, column.scrollHeight || 0) / columnWidth;
    });

    const averageColumnWidth = totalColumnWidth / masonryState.columns.length;
    masonryState.gapWeight = averageColumnWidth > 0
        ? gapPx / averageColumnWidth
        : PROMPT_GALLERY_MASONRY_CARD_GAP_WEIGHT;
}

function schedulePromptGalleryMasonryHeightSync() {
    if (promptGalleryMasonryHeightSyncFrameId) return;
    promptGalleryMasonryHeightSyncFrameId = requestAnimationFrame(() => {
        promptGalleryMasonryHeightSyncFrameId = null;
        syncPromptGalleryMasonryColumnHeights();
    });
}

function preparePromptGalleryContainer(grid) {
    promptGalleryMasonrySignature = getPromptGalleryMasonrySignature(grid);
    return createPromptGalleryMasonryState(grid);
}

function appendPromptGalleryCard(grid, card, index = 0, masonryState = null) {
    if (!grid || !card) return;

    applyPromptGalleryMasonryCardLayout(card, index);

    if (!masonryState?.columns?.length) {
        grid.appendChild(card);
        return;
    }

    const targetColumnIndex = getPromptGalleryMasonryTargetColumnIndex(masonryState.columnHeights);
    const targetColumn = masonryState.columns[targetColumnIndex] || masonryState.columns[0];
    targetColumn.appendChild(card);
    masonryState.columnHeights[targetColumnIndex] += getPromptGalleryMasonryCardAspectWeight(card, index)
        + (masonryState.gapWeight || PROMPT_GALLERY_MASONRY_CARD_GAP_WEIGHT);
}

function setPromptGalleryResizeLightMode() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    document.documentElement.classList.add(PROMPT_GALLERY_RESIZE_LIGHT_MODE_CLASS);
    if (promptGalleryResizeLightModeTimerId) {
        window.clearTimeout(promptGalleryResizeLightModeTimerId);
    }

    promptGalleryResizeLightModeTimerId = window.setTimeout(() => {
        promptGalleryResizeLightModeTimerId = null;
        document.documentElement.classList.remove(PROMPT_GALLERY_RESIZE_LIGHT_MODE_CLASS);
    }, PROMPT_GALLERY_RESIZE_LIGHT_MODE_MS);
}

function syncPromptGalleryMasonryLayout() {
    const grid = document.querySelector('.gallery-container');
    const nextSignature = getPromptGalleryMasonrySignature(grid);
    if (promptGalleryMasonrySignature === null) {
        promptGalleryMasonrySignature = nextSignature;
        return;
    }
    if (promptGalleryMasonrySignature === nextSignature) return;

    promptGalleryMasonrySignature = nextSignature;

    if (promptGalleryHasRendered) {
        renderCurrentPage({ preserveScroll: true });
        return;
    }

    renderPromptGallerySkeletons();
}

function schedulePromptGalleryMasonrySync() {
    setPromptGalleryResizeLightMode();

    if (promptGalleryMasonryResizeTimerId) {
        window.clearTimeout(promptGalleryMasonryResizeTimerId);
    }

    promptGalleryMasonryResizeTimerId = window.setTimeout(() => {
        promptGalleryMasonryResizeTimerId = null;
        syncPromptGalleryMasonryLayout();
    }, PROMPT_GALLERY_MASONRY_RESIZE_DEBOUNCE_MS);
}

function bindPromptGalleryMasonryWatcher() {
    if (window.__promptGalleryMasonryWatcherBound) return;
    window.__promptGalleryMasonryWatcherBound = true;

    window.addEventListener('resize', schedulePromptGalleryMasonrySync, { passive: true });
    window.addEventListener('orientationchange', schedulePromptGalleryMasonrySync, { passive: true });

    if (typeof window.matchMedia === 'function') {
        const mediaQueryList = window.matchMedia(PROMPT_GALLERY_MOBILE_MASONRY_QUERY);
        if (typeof mediaQueryList.addEventListener === 'function') {
            mediaQueryList.addEventListener('change', schedulePromptGalleryMasonrySync);
        } else if (typeof mediaQueryList.addListener === 'function') {
            mediaQueryList.addListener(schedulePromptGalleryMasonrySync);
        }
    }
}

function renderPromptGallerySkeletons(count = PROMPT_GALLERY_SKELETON_COUNT) {
    const grid = document.querySelector('.gallery-container');
    if (!grid) return;

    const safeCount = Math.min(Math.max(Number.parseInt(count, 10) || PROMPT_GALLERY_SKELETON_COUNT, 4), 12);
    grid.classList.add('visible');
    const masonryState = preparePromptGalleryContainer(grid);
    Array.from({ length: safeCount }).forEach((_, index) => {
        const card = document.createElement('div');
        card.className = 'prompt-card prompt-card--skeleton';
        card.setAttribute('aria-hidden', 'true');
        card.dataset.skeletonIndex = String(index);
        card.innerHTML = buildPromptCardSkeletonMarkup(index);
        appendPromptGalleryCard(grid, card, index, masonryState);
    });
}

function markPromptCardImageReady(card, cardImage) {
    if (!card) return;
    applyPromptCardNaturalImageAspectRatio(card, cardImage);
    card.classList.remove('prompt-card--loading');
    card.classList.add('prompt-card--loaded');
    cardImage?.classList.add('loaded');
    schedulePromptGalleryMasonryHeightSync();
}

function setPromptCardImageSource(cardImage, imageAsset) {
    if (!cardImage || !imageAsset) return;
    const card = cardImage.closest?.('.prompt-card') || null;
    applyPromptCardImageAssetAspectRatio(card, imageAsset);

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

function disconnectPromptGalleryCardImageObserver() {
    promptGalleryCardImageObserver?.disconnect();
    promptGalleryCardImageObserver = null;
    promptGalleryPendingImageActivations.clear();
    if (promptGalleryImageActivationTimerId) {
        window.clearTimeout(promptGalleryImageActivationTimerId);
        promptGalleryImageActivationTimerId = null;
    }
}

function activatePromptGalleryCardImage(cardImage) {
    if (!cardImage || cardImage.dataset.imageSourceActive === 'true') return;
    const imageAsset = promptGalleryDeferredImageAssets.get(cardImage);
    if (!imageAsset) return;

    cardImage.dataset.imageSourceActive = 'true';
    promptGalleryDeferredImageAssets.delete(cardImage);
    promptGalleryPendingImageActivations.delete(cardImage);
    promptGalleryCardImageObserver?.unobserve(cardImage);
    setPromptCardImageSource(cardImage, imageAsset);
}

function queuePromptGalleryPendingImageActivations() {
    if (
        promptGalleryImageActivationTimerId
        || promptGalleryPendingImageActivations.size === 0
        || document.documentElement.classList.contains('prompt-gallery-scrolling')
    ) {
        return;
    }

    const activateChunk = () => {
        promptGalleryImageActivationTimerId = null;
        if (document.documentElement.classList.contains('prompt-gallery-scrolling')) return;

        let activatedCount = 0;
        for (const cardImage of promptGalleryPendingImageActivations) {
            if (!cardImage.isConnected) {
                promptGalleryPendingImageActivations.delete(cardImage);
                continue;
            }
            activatePromptGalleryCardImage(cardImage);
            activatedCount += 1;
            if (activatedCount >= PROMPT_GALLERY_IMAGE_ACTIVATION_CHUNK_SIZE) break;
        }

        if (promptGalleryPendingImageActivations.size > 0) {
            promptGalleryImageActivationTimerId = window.setTimeout(
                activateChunk,
                PROMPT_GALLERY_IMAGE_ACTIVATION_INTERVAL_MS
            );
        }
    };

    promptGalleryImageActivationTimerId = window.setTimeout(activateChunk, 0);
}

function getPromptGalleryCardImageObserver() {
    if (promptGalleryCardImageObserver || typeof IntersectionObserver === 'undefined') {
        return promptGalleryCardImageObserver;
    }

    promptGalleryCardImageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                promptGalleryPendingImageActivations.add(entry.target);
            } else {
                promptGalleryPendingImageActivations.delete(entry.target);
            }
        });
        if (document.documentElement.classList.contains('prompt-gallery-scrolling')) {
            schedulePromptGalleryScrollIdlePreload();
            return;
        }
        queuePromptGalleryPendingImageActivations();
    }, {
        root: null,
        rootMargin: `${PROMPT_GALLERY_IMAGE_ACTIVATION_MARGIN_PX}px 0px`,
        threshold: 0.01
    });

    return promptGalleryCardImageObserver;
}

function observePromptGalleryCardImage(cardImage, imageAsset) {
    if (!cardImage || !imageAsset) return;
    promptGalleryDeferredImageAssets.set(cardImage, imageAsset);
    const observer = getPromptGalleryCardImageObserver();
    if (!observer) {
        activatePromptGalleryCardImage(cardImage);
        return;
    }
    observer.observe(cardImage);
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
    return buildSearchIndexIncrementally();
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

async function warmPromptRelatedProfiles() {
    if (!Array.isArray(PROMPTS) || PROMPTS.length === 0) {
        return 0;
    }

    await warmPromptSearchIndex();
    const sourcePrompts = PROMPTS;
    const sourceLength = sourcePrompts.length;
    let warmedCount = 0;
    let cursor = 0;

    while (cursor < sourceLength) {
        const deadline = await waitForPromptIdleChunk();
        const startedAt = getPromptWorkNow();
        let processedCount = 0;

        while (cursor < sourceLength) {
            const item = sourcePrompts[cursor];
            cursor += 1;
            processedCount += 1;
            if (item && getPromptImageAssets(item).length > 0) {
                getPromptRelatedProfile(item);
                warmedCount += 1;
            }
            if (shouldYieldPromptWork(deadline, startedAt, processedCount, PROMPT_RELATED_PROFILE_CHUNK_SIZE)) break;
        }

        if (PROMPTS !== sourcePrompts || PROMPTS.length !== sourceLength) break;
    }

    return warmedCount;
}

function schedulePromptRelatedProfileWarmup() {
    schedulePromptIdleTask('related-profile-warmup', warmPromptRelatedProfiles, {
        delayMs: PROMPTS_DEFERRED_SEARCH_INDEX_DELAY_MS + 900,
        timeoutMs: 2600
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
        script.src = 'starry-sky.js?v=20260729_AI_WORKBENCH_SCROLL_PERF_1';
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

function loadPromptStarrySkyRuntimeForTheme() {
    if (!shouldLoadPromptStarrySkyRuntime()) {
        return;
    }

    void loadPromptStarrySkyRuntime({ force: true }).catch((error) => {
        console.warn('[Prompts] Starry sky runtime failed to load after theme switch:', error?.message || error);
    });
}

function bindPromptThemeStarryLoader() {
    if (!document.getElementById('starryCanvas')) {
        return;
    }

    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(loadPromptStarrySkyRuntimeForTheme);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    window.addEventListener('zaoyoe:themechange', loadPromptStarrySkyRuntimeForTheme);
}

function schedulePromptsDeferredEnhancements() {
    if (promptsDeferredEnhancementsScheduled) {
        return;
    }
    promptsDeferredEnhancementsScheduled = true;

    schedulePromptSearchIndexWarmup();
    schedulePromptRelatedProfileWarmup();
    schedulePromptIdleTask('spotlight', () => initSpotlight(), {
        delayMs: PROMPTS_DEFERRED_VISUAL_DELAY_MS,
        timeoutMs: PROMPTS_DEFERRED_TASK_TIMEOUT_MS
    });
    schedulePromptIdleTask('scroll-reveal', () => setupScrollReveal(), {
        delayMs: PROMPTS_DEFERRED_VISUAL_DELAY_MS,
        timeoutMs: PROMPTS_DEFERRED_TASK_TIMEOUT_MS
    });
    schedulePromptIdleTask('starry-sky', () => loadPromptStarrySkyRuntime(), {
        delayMs: PROMPTS_DEFERRED_VISUAL_DELAY_MS + 1200,
        timeoutMs: 2400
    });
    schedulePromptIdleTask('comment-count-prefetch', () => preloadPromptCommentCounts(), {
        delayMs: PROMPTS_DEFERRED_COMMENT_COUNT_DELAY_MS,
        timeoutMs: 3000
    });
    schedulePromptIdleTask('hotness-prefetch', () => loadPromptHotnessMetrics(), {
        delayMs: 0,
        timeoutMs: 1800
    });
}

function getPromptInitialFilterFromLocation() {
    const urlParams = new URLSearchParams(window.location.search);
    const tagParam = urlParams.get('tag');
    return {
        tagParam,
        initialFilter: tagParam || 'all'
    };
}

async function completePromptPageInitialRender(initialFilter = 'all', tagParam = '') {
    if (promptPageInitialRenderStarted) {
        return;
    }
    promptPageInitialRenderStarted = true;

    if (promptLiveDataRetryTimer) {
        window.clearTimeout(promptLiveDataRetryTimer);
        promptLiveDataRetryTimer = null;
    }

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

    const promptNavReadyPromise = generateDynamicNav(); // New: AI-driven navigation
    const featuredFirstPaintPromise = renderFeaturedBanner({ waitForFirstImage: true });
    const galleryConfigPromise = loadGalleryConfigForFirstRender();
    await promptNavReadyPromise;

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

    bindPromptFavoriteAuthListener();
    await syncPromptFavoriteAuthState({ force: true });
    await featuredFirstPaintPromise;
    await galleryConfigPromise;
    renderGallery(initialFilter);
    setupFilters();
    setupPromptMediaFilters();
    setupInfiniteScroll();
    setupSearch(); // Pinterest-style search
    checkAuthState(); // New: Check if admin is logged in
    schedulePromptsDeferredEnhancements();

    // Check for URL parameter to open specific prompt
    handleUrlPromptParam();
}

function schedulePromptLiveDataRetry(initialFilter = 'all', tagParam = '') {
    if (promptPageInitialRenderStarted || promptLiveDataRetryTimer) {
        return;
    }

    promptLiveDataRetryTimer = window.setTimeout(async () => {
        promptLiveDataRetryTimer = null;
        const loaded = await loadPromptsFromSupabase({
            clientReadyTimeoutMs: PROMPT_SUPABASE_CLIENT_READY_TIMEOUT_MS
        });

        if (loaded) {
            await completePromptPageInitialRender(initialFilter, tagParam);
            return;
        }

        schedulePromptLiveDataRetry(initialFilter, tagParam);
    }, PROMPT_SUPABASE_RETRY_DELAY_MS);
}

document.addEventListener('DOMContentLoaded', async () => {
    bindPromptImageDragLock();
    bindPromptThemeStarryLoader();
    initializePromptStaticControls();
    syncPromptNavOffset();
    bindPromptGalleryMasonryWatcher();
    renderPromptNavSkeletons();
    void waitForPromptNavFont();
    renderFeaturedBannerSkeleton();
    renderPromptGallerySkeletons();

    const { tagParam, initialFilter } = getPromptInitialFilterFromLocation();

    // Try to load from Supabase first. If it is slow or temporarily unavailable,
    // keep the skeletons instead of showing deleted cards from an old static snapshot.
    const loaded = await loadPromptsFromSupabase();
    if (!loaded) {
        schedulePromptLiveDataRetry(initialFilter, tagParam);
        return;
    }

    await completePromptPageInitialRender(initialFilter, tagParam);
});

window.addEventListener('languageChanged', () => {
    if (!Array.isArray(PROMPTS) || PROMPTS.length === 0) {
        return;
    }

    void renderFeaturedBanner();
    renderGallery(currentFilter, false);
    syncPromptSourceActionLabels();
    syncPromptRelatedTriggerLabel();
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

    const prompt = findPromptForModalOpen(targetIdStr);

    if (prompt) {
        console.log('✅ 找到 prompt:', prompt.title, '索引:', prompt.id);

        // 清除待处理 ID
        pendingPromptId = null;

        // 稍微延迟以确保 Gallery 渲染完成
        setTimeout(() => {
            openPromptModal(getPromptStableOpenId(prompt));

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
        || PROMPTS.find(p => String(p.supabase_id) === targetId)
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

            openPromptModal(getPromptStableOpenId(prompt));
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

async function generateDynamicNav() {
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

    await waitForPromptNavFont();

    navContainer.classList.remove('nav-items--skeleton');
    navContainer.classList.add('nav-items--hydrated');
    navContainer.innerHTML = navHTML;

    // Store for back navigation
    originalNavHTML = navContainer.innerHTML;

    // Mark as loaded for fade-in
    navContainer.classList.add('loaded');
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

function bindFeaturedBannerActivation(banner, promptId = '') {
    if (!banner) {
        return;
    }

    const normalizedPromptId = String(promptId ?? '').trim();
    banner.onclick = null;
    if (banner._promptFeaturedClickHandler) {
        banner.removeEventListener('click', banner._promptFeaturedClickHandler);
        banner._promptFeaturedClickHandler = null;
    }

    banner.querySelectorAll('.featured-image-container, .featured-content').forEach((target) => {
        target.onclick = null;
    });

    if (!normalizedPromptId) {
        return;
    }

    banner._promptFeaturedClickHandler = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const hitTarget = target?.closest('.featured-image-container, .featured-content');
        if (!hitTarget || !banner.contains(hitTarget)) {
            return;
        }
        openPromptModal(normalizedPromptId);
    };
    banner.addEventListener('click', banner._promptFeaturedClickHandler);
}

function getFeaturedBannerModalPromptId(featured = {}) {
    const directId = String(featured?.id ?? '').trim();
    const supabaseId = String(featured?.supabaseId ?? featured?.supabase_id ?? '').trim();
    if (Array.isArray(PROMPTS)) {
        const prompt = PROMPTS.find((item) => (
            String(item?.supabaseId ?? item?.supabase_id ?? '').trim() === directId
            || (supabaseId && String(item?.supabaseId ?? item?.supabase_id ?? '').trim() === supabaseId)
            || String(item?.id ?? '').trim() === directId
        ));
        const stablePromptId = getPromptStableOpenId(prompt);
        if (stablePromptId) {
            return stablePromptId;
        }
    }
    return featured?.supabaseId ?? featured?.supabase_id ?? featured?.id ?? '';
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
        bindFeaturedBannerActivation(banner, '');
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
    bindFeaturedBannerActivation(banner, getFeaturedBannerModalPromptId(featured));
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
    // Disabled: the cursor-following nav spotlight reads as a gray smudge near search.
}

// --- Infinite Gallery State ---
let CARDS_PER_PAGE = 20; // Default initial/incremental render batch size.
let currentFilter = 'all';
let currentPromptMediaFilter = 'image';
let currentPromptSort = 'random';
let promptGalleryBaseFilteredItems = [];
const promptRandomOrderKeys = new Map();
const promptHotnessMetrics = new Map();
let promptHotnessLoadPromise = null;
let isLoading = false;
let allFilteredItems = [];
let allCardsRendered = false; // Track if all filtered cards have been rendered.
let promptGalleryHasRendered = false;
let renderedCards = new Map(); // Cache rendered cards by id
let promptGalleryRenderedCount = 0;
let promptGalleryMasonryState = null;
let promptGalleryLastScrollY = 0;
let promptGalleryLastScrollDirection = 'down';
let promptGalleryScrollIdleTimerId = null;
let promptGalleryInfiniteScrollBound = false;
let promptGalleryTouchLastY = 0;
let promptGalleryCardMotionObserver = null;
let promptGalleryLoadSentinelObserver = null;
let promptGalleryRenderChunkFrameId = null;
let promptGalleryQueuedRenderTarget = 0;
let promptGallerySentinelFillRequested = false;
const PROMPT_GALLERY_SCROLL_PRELOAD_COUNT = 8;
const PROMPT_GALLERY_RENDER_CHUNK_SIZE = 2;
const PROMPT_GALLERY_DESKTOP_PREFETCH_ROWS = 2;
const PROMPT_GALLERY_SCROLL_IDLE_MS = 180;
const PROMPT_GALLERY_BOTTOM_LOAD_MARGIN_PX = 900;
const PROMPT_GALLERY_SENTINEL_PREFETCH_MARGIN_PX = 1600;

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
        if (!isPromptFavoriteUserAuthenticated()) {
            return new Set();
        }

        try {
            // Load all favorites data from localStorage
            const storedFavorites = JSON.parse(localStorage.getItem(getPromptFavoriteStorageKey()) || '[]');
            // Count how many times each prompt appears in all users' favorites
            // For now, we use a simple approach: check if the prompt is in the current user's favorites
            const favSet = new Set(storedFavorites.map(normalizePromptFavoriteId).filter(Boolean));
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
                const aFav = favSet.has(normalizePromptFavoriteId(a.id)) ? 1 : 0;
                const bFav = favSet.has(normalizePromptFavoriteId(b.id)) ? 1 : 0;

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
const PROMPT_FAVORITES_USER_STORAGE_PREFIX = 'promptFavoritesStable:user:';
const PROMPT_FAVORITES_LEGACY_STORAGE_PREFIX = 'promptFavorites:user:';
let promptFavoriteAuthUserId = '';
let promptFavoriteAuthListenerBound = false;
let promptFavoriteMutationVersion = 0;
let favorites = new Set();

function normalizePromptFavoriteId(id = '') {
    return String(id ?? '').trim();
}

function normalizePromptFavoriteUserId(id = '') {
    return String(id ?? '').trim();
}

function getPromptFavoriteStorageKey(userId = promptFavoriteAuthUserId) {
    const normalizedUserId = normalizePromptFavoriteUserId(userId);
    return normalizedUserId ? `${PROMPT_FAVORITES_USER_STORAGE_PREFIX}${normalizedUserId}` : '';
}

function migrateLegacyPromptFavorites(userId = promptFavoriteAuthUserId) {
    const normalizedUserId = normalizePromptFavoriteUserId(userId);
    const storageKey = getPromptFavoriteStorageKey(normalizedUserId);
    if (!normalizedUserId || !storageKey) return;

    try {
        if (localStorage.getItem(storageKey) !== null) return;
        const legacyKey = `${PROMPT_FAVORITES_LEGACY_STORAGE_PREFIX}${normalizedUserId}`;
        const parsed = JSON.parse(localStorage.getItem(legacyKey) || '[]');
        const legacyIds = Array.isArray(parsed) ? parsed : [];
        const stableIds = legacyIds.flatMap((legacyId) => {
            const normalizedLegacyId = normalizePromptFavoriteId(legacyId);
            const item = PROMPTS.find((prompt) => normalizePromptFavoriteId(prompt?.id) === normalizedLegacyId);
            const persistentId = String(item?.supabaseId ?? item?.supabase_id ?? '').trim();
            return persistentId ? [persistentId] : [];
        });
        localStorage.setItem(storageKey, JSON.stringify([...new Set(stableIds)]));
    } catch (error) {
        // Storage may be unavailable in privacy-restricted browsers.
    }
}

function getStoredPromptFavorites(storageKey = getPromptFavoriteStorageKey()) {
    if (!storageKey) {
        return [];
    }

    try {
        const storedFavorites = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (!Array.isArray(storedFavorites)) {
            return [];
        }
        return storedFavorites.map(normalizePromptFavoriteId).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function isPromptFavoriteUserAuthenticated() {
    return Boolean(promptFavoriteAuthUserId);
}

function isPromptFavoriteSaved(id) {
    return isPromptFavoriteUserAuthenticated() && favorites.has(normalizePromptFavoriteId(id));
}

function getPromptFavoriteLocalKnownCount(id = '') {
    const favoriteId = normalizePromptFavoriteId(id);
    if (!favoriteId) {
        return 0;
    }

    const userIds = new Set();
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index) || '';
            if (!key.startsWith(PROMPT_FAVORITES_USER_STORAGE_PREFIX)) {
                continue;
            }
            const userId = key.slice(PROMPT_FAVORITES_USER_STORAGE_PREFIX.length).trim();
            if (!userId) {
                continue;
            }
            const storedFavorites = new Set(getStoredPromptFavorites(key));
            if (storedFavorites.has(favoriteId)) {
                userIds.add(userId);
            }
        }
    } catch (e) {
        // If storage is unavailable, fall back to the current in-memory user state.
    }

    if (isPromptFavoriteUserAuthenticated() && favorites.has(favoriteId)) {
        userIds.add(promptFavoriteAuthUserId);
    }

    return userIds.size;
}

function saveFavorites() {
    if (!isPromptFavoriteUserAuthenticated()) {
        return;
    }

    const storageKey = getPromptFavoriteStorageKey();
    if (!storageKey) {
        return;
    }

    try {
        localStorage.setItem(storageKey, JSON.stringify([...favorites].map(normalizePromptFavoriteId).filter(Boolean)));
    } catch (error) {
        // Keep the in-memory state when storage is unavailable.
    }
}

async function syncPromptFavoriteToSupabase(promptId, shouldSave) {
    const normalizedPromptId = normalizePromptFavoriteId(promptId);
    if (!normalizedPromptId || !promptFavoriteAuthUserId || !window.supabaseClient) return false;

    const site = window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
    try {
        if (shouldSave) {
            const { error } = await window.supabaseClient
                .from('prompt_favorites')
                .upsert({
                    user_id: promptFavoriteAuthUserId,
                    prompt_id: normalizedPromptId,
                    site
                }, { onConflict: 'user_id,prompt_id,site' });
            if (error) throw error;
        } else {
            const { error } = await window.supabaseClient
                .from('prompt_favorites')
                .delete()
                .eq('user_id', promptFavoriteAuthUserId)
                .eq('prompt_id', normalizedPromptId)
                .eq('site', site);
            if (error) throw error;
        }
        return true;
    } catch (error) {
        console.warn('[PromptFavorites] Cloud sync failed; local favorite remains available:', error?.message || error);
        return false;
    }
}

async function hydratePromptFavoriteCloudState() {
    if (!promptFavoriteAuthUserId || !window.supabaseClient) return favorites;

    const requestedUserId = promptFavoriteAuthUserId;
    const requestedMutationVersion = promptFavoriteMutationVersion;
    const site = window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
    try {
        const { data, error } = await window.supabaseClient
            .from('prompt_favorites')
            .select('prompt_id')
            .eq('user_id', requestedUserId)
            .eq('site', site);
        if (error) throw error;
        if (requestedUserId !== promptFavoriteAuthUserId) return favorites;
        if (requestedMutationVersion !== promptFavoriteMutationVersion) return favorites;

        const cloudFavorites = (Array.isArray(data) ? data : [])
            .map((row) => normalizePromptFavoriteId(row?.prompt_id))
            .filter(Boolean);
        const mergedFavorites = new Set([...favorites, ...cloudFavorites]);
        const localOnlyFavorites = [...mergedFavorites].filter((promptId) => !cloudFavorites.includes(promptId));
        favorites = mergedFavorites;
        saveFavorites();

        if (localOnlyFavorites.length > 0) {
            const { error: upsertError } = await window.supabaseClient
                .from('prompt_favorites')
                .upsert(localOnlyFavorites.map((promptId) => ({
                    user_id: requestedUserId,
                    prompt_id: promptId,
                    site
                })), { onConflict: 'user_id,prompt_id,site' });
            if (upsertError) throw upsertError;
        }
        syncPromptFavoriteButtons();
        if (currentFilter === 'favorites' && promptGalleryHasRendered) {
            promptGalleryBaseFilteredItems = PROMPTS.filter((prompt) => (
                isPromptFavoriteSaved(getPromptFavoriteIdForItem(prompt))
            ));
            allFilteredItems = applyPromptGalleryFiltersAndSort();
            renderCurrentPage({ preserveScroll: true });
        }
        return favorites;
    } catch (error) {
        console.warn('[PromptFavorites] Cloud hydration failed; using local favorites:', error?.message || error);
        return favorites;
    }
}

function normalizePromptFavoriteCount(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return Math.max(0, Number.parseInt(fallback, 10) || 0);
    }
    return Math.max(0, parsed);
}

function getPromptFavoriteBaseCount(item = {}) {
    return normalizePromptFavoriteCount(
        item.favoriteCount
        ?? item.favorite_count
        ?? item.favCount
        ?? item.likes
        ?? item.saveCount
        ?? item.saved_count
        ?? 0
    );
}

function getPromptFavoriteDisplayCount(item = {}) {
    const baseCount = getPromptFavoriteBaseCount(item);
    const favoriteId = getPromptFavoriteIdForItem(item);
    return baseCount + getPromptFavoriteLocalKnownCount(favoriteId);
}

function getPromptFavoriteIdForItem(item = {}) {
    const persistentId = String(item.supabaseId ?? item.supabase_id ?? '').trim();
    if (persistentId) return normalizePromptFavoriteId(persistentId);
    const itemId = normalizePromptFavoriteId(item.id ?? '');
    if (itemId) {
        return itemId;
    }

    const currentId = String(currentPromptId ?? '').trim();
    if (currentId && Array.isArray(PROMPTS)) {
        const galleryItem = PROMPTS.find((prompt) => {
            return String(prompt?.supabaseId ?? '').trim() === currentId
                || String(prompt?.id ?? '').trim() === currentId;
        });
        if (galleryItem) {
            return normalizePromptFavoriteId(galleryItem.supabaseId ?? galleryItem.supabase_id ?? galleryItem.id ?? currentId);
        }
    }

    return normalizePromptFavoriteId(persistentId || currentId);
}

function setPromptFavoriteButtonState(btn, id) {
    if (!btn) {
        return false;
    }

    const favoriteId = normalizePromptFavoriteId(id);
    const isSaved = isPromptFavoriteSaved(favoriteId);
    const label = getPromptFavoriteActionLabel(isSaved);
    btn.classList.toggle('saved', isSaved);
    btn.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
    btn.setAttribute('aria-label', label);
    btn.dataset.tooltip = label;
    const icon = btn.querySelector('i');
    if (icon) {
        icon.classList.remove('fas');
        icon.classList.add('far');
    }
    return isSaved;
}

function updatePromptFavoriteButtonState(btn, id) {
    if (!btn) {
        return;
    }

    const favoriteId = normalizePromptFavoriteId(id);
    setPromptFavoriteButtonState(btn, favoriteId);
    const countEl = btn.closest('.card-favorite-cluster')?.querySelector('.card-favorite-count');
    if (countEl) {
        const baseCount = normalizePromptFavoriteCount(countEl.dataset.baseCount || '0');
        countEl.textContent = String(baseCount + getPromptFavoriteLocalKnownCount(favoriteId));
    }
}

function syncPromptFavoriteButtons() {
    document.querySelectorAll('.prompt-card').forEach((card) => {
        const button = card.querySelector('.card-fav-btn');
        if (!button) {
            return;
        }
        updatePromptFavoriteButtonState(button, button.dataset.promptFavoriteId || card.dataset.favoriteId || card.dataset.id || '');
    });
    document.querySelectorAll('#promptModalSourceActions .card-fav-btn').forEach((button) => {
        updatePromptFavoriteButtonState(button, button.dataset.promptFavoriteId || '');
    });
}

function syncPromptSourceActionLabels() {
    document.querySelectorAll('.card-fav-btn').forEach((button) => {
        const isSaved = button.classList.contains('saved') || button.getAttribute('aria-pressed') === 'true';
        const label = getPromptFavoriteActionLabel(isSaved);
        button.setAttribute('aria-label', label);
        button.dataset.tooltip = label;
    });

    const sourceLabel = getPromptSourceActionLabel();
    document.querySelectorAll('a.card-source-link').forEach((link) => {
        link.setAttribute('aria-label', sourceLabel);
        link.dataset.tooltip = sourceLabel;
    });

    const shareLabel = getPromptShareActionLabel();
    document.querySelectorAll('.card-share-btn').forEach((button) => {
        button.setAttribute('aria-label', shareLabel);
        button.dataset.tooltip = shareLabel;
    });

    const relatedLabel = getPromptRelatedActionLabel();
    document.querySelectorAll('.related-trigger-btn').forEach((button) => {
        button.setAttribute('aria-label', relatedLabel);
        button.dataset.tooltip = relatedLabel;
    });
}

function openPromptFavoriteLoginModal() {
    if (typeof window.requestLoginModalOpen === 'function') {
        window.requestLoginModalOpen('login');
        return;
    }
    showLoginModal();
}

function toggleFavorite(id, btn, e) {
    e?.stopPropagation?.();
    e?.stopImmediatePropagation?.(); // Ensure no other click listeners fire
    const favoriteId = normalizePromptFavoriteId(id);
    if (!favoriteId) {
        return;
    }

    if (!isPromptFavoriteUserAuthenticated()) {
        updatePromptFavoriteButtonState(btn, favoriteId);
        openPromptFavoriteLoginModal();
        return;
    }

    // Trigger bounce animation
    btn.classList.add('animating');
    setTimeout(() => btn.classList.remove('animating'), 400);

    const shouldSave = !isPromptFavoriteSaved(favoriteId);
    promptFavoriteMutationVersion += 1;
    if (!shouldSave) {
        favorites.delete(favoriteId);
    } else {
        favorites.add(favoriteId);
    }
    saveFavorites();
    updatePromptFavoriteButtonState(btn, favoriteId);
    syncPromptFavoriteButtons();
    void syncPromptFavoriteToSupabase(favoriteId, shouldSave);

    // If viewing favorites, remove card if unsaved
    if (currentFilter === 'favorites' && !isPromptFavoriteSaved(favoriteId)) {
        const card = btn.closest('.prompt-card');
        hidePromptCard(card, true);
    }
}

function buildPromptFavoriteClusterMarkup(item = {}, options = {}) {
    const favoriteId = normalizePromptFavoriteId(options.favoriteId ?? getPromptFavoriteIdForItem(item));
    const isSaved = isPromptFavoriteSaved(favoriteId);
    const favoriteBaseCount = getPromptFavoriteBaseCount(item);
    const favoriteDisplayCount = getPromptFavoriteDisplayCount({
        ...item,
        id: favoriteId
    });
    const buttonClassName = `${options.buttonClassName || 'card-fav-btn'}${isSaved ? ' saved' : ''}`;
    const countClassName = options.countClassName || 'card-favorite-count';
    const favoriteLabel = getPromptFavoriteActionLabel(isSaved);

    return `
        <span class="card-favorite-cluster">
            <button class="${buttonClassName}" type="button" aria-label="${escapeHtml(favoriteLabel)}" aria-pressed="${isSaved ? 'true' : 'false'}" data-tooltip="${escapeHtml(favoriteLabel)}" data-prompt-favorite-id="${escapeHtml(favoriteId)}">
                <i class="far fa-heart"></i>
            </button>
            <span class="${countClassName}" data-base-count="${favoriteBaseCount}">${favoriteDisplayCount}</span>
        </span>
    `;
}

function buildPromptSourceLinkMarkup(item = {}, options = {}) {
    const sourceAttribution = getPromptSourceAttribution(item);
    const className = options.className || 'card-source-link';
    const markMarkup = '<span class="x-logo-mark" aria-hidden="true"></span>';
    const sourceLabel = getPromptSourceActionLabel();
    if (sourceAttribution.sourceUrl) {
        return `<a class="${className}" href="${escapeHtml(sourceAttribution.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(sourceLabel)}" data-tooltip="${escapeHtml(sourceLabel)}">${markMarkup}</a>`;
    }
    return `<span class="${className} card-source-link--disabled" aria-hidden="true">${markMarkup}</span>`;
}

function getPromptShareId(item = {}) {
    return String(
        item.supabaseId
        ?? item.supabase_id
        ?? item.id
        ?? currentPromptId
        ?? ''
    ).trim();
}

function getPromptShareUrl(item = {}) {
    const shareId = getPromptShareId(item);
    const url = new URL(window.location.href);
    url.pathname = url.pathname || '/prompts.html';
    url.search = '';
    if (shareId) {
        url.searchParams.set('id', shareId);
    }
    url.hash = '';
    return url.href;
}

function buildPromptShareButtonMarkup(item = {}) {
    const shareLabel = getPromptShareActionLabel();
    const shareUrl = getPromptShareUrl(item);
    const shareIconMarkup = '<svg class="share-upload-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5V3.8"></path><path d="M7.2 8.7L12 3.8L16.8 8.7"></path><path d="M5.2 13.1V19.4C5.2 20.2 5.8 20.8 6.6 20.8H17.4C18.2 20.8 18.8 20.2 18.8 19.4V13.1"></path></svg>';
    return `
        <button class="card-share-btn" type="button" aria-label="${escapeHtml(shareLabel)}" data-tooltip="${escapeHtml(shareLabel)}" data-share-url="${escapeHtml(shareUrl)}">
            ${shareIconMarkup}
        </button>
    `;
}

async function writePromptShareTextToClipboard(text = '') {
    const value = String(text || '').trim();
    if (!value) {
        return false;
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        return document.execCommand('copy');
    } finally {
        textarea.remove();
    }
}

async function copyPromptShareLink(item = {}, button = null, event = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const shareUrl = button?.dataset?.shareUrl || getPromptShareUrl(item);
    try {
        const copied = await writePromptShareTextToClipboard(shareUrl);
        if (!copied) {
            throw new Error('Clipboard copy returned false');
        }
        const originalContent = button?.innerHTML || '';
        if (button) {
            button.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
        }
        button?.classList.add('copied');
        setTimeout(() => {
            if (button) {
                button.innerHTML = originalContent;
            }
            button?.classList.remove('copied');
        }, 1500);
    } catch (error) {
        console.error('Prompt share copy failed:', error);
        showGalleryToast(getPromptShareCopyFailedLabel(), 'error', 2200);
    }
}

function bindPromptSourceActionEvents(root, favoriteId = '') {
    if (!root) {
        return;
    }

    const favoriteButton = root.querySelector('.card-fav-btn');
    favoriteButton?.addEventListener('click', (event) => {
        toggleFavorite(favoriteId || favoriteButton.dataset.promptFavoriteId || '', favoriteButton, event);
    });
    root.querySelectorAll('.card-source-link').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    });
}

function renderPromptHeaderShareAction(item = {}) {
    const shareSlot = document.getElementById('promptHeaderShareSlot');
    if (!shareSlot) {
        return;
    }

    shareSlot.innerHTML = buildPromptShareButtonMarkup(item);
    shareSlot.querySelectorAll('.card-share-btn').forEach((button) => {
        button.classList.add('prompt-header-share-btn');
        button.addEventListener('click', (event) => {
            copyPromptShareLink(item, button, event);
        });
    });
}

const PROMPT_RELATED_MIN_SCORE = 60;
const PROMPT_RELATED_MIN_STRUCTURED_OVERLAPS = 4;
const PROMPT_RELATED_MIN_BRIDGE_OVERLAPS = 3;
const PROMPT_RELATED_MIN_TOTAL_EVIDENCE = 7;
const PROMPT_RELATED_MIN_STRUCTURED_JACCARD = 0.16;
const PROMPT_RELATED_MIN_STRUCTURED_COVERAGE = 0.22;
const PROMPT_RELATED_STOPWORDS = new Set([
    'prompt',
    'prompts',
    'image',
    'images',
    'photo',
    'picture',
    'style',
    'styles',
    'fashion',
    'editorial',
    'storyboard',
    'scene',
    'scenes',
    'shot',
    'shots',
    'photography',
    'cinematic',
    'guide',
    'palette',
    'color',
    'colors',
    'city',
    'urban',
    'architecture',
    'architectural',
    'girl',
    'girls',
    'woman',
    'women',
    'female',
    'model',
    'young',
    'generate',
    'create',
    'design',
    'art',
    'ai',
    '提示词',
    '提示',
    '图片',
    '图像',
    '照片',
    '风格',
    '时尚',
    '编辑',
    '社论',
    '分镜',
    '场景',
    '镜头',
    '摄影',
    '电影感',
    '指南',
    '配色',
    '色彩',
    '颜色',
    '城市',
    '都市',
    '建筑',
    '女孩',
    '少女',
    '女性',
    '女人',
    '模特',
    '年轻',
    '生成',
    '设计',
    '作品',
    '画面'
]);
const PROMPT_RELATED_FACET_DEFINITIONS = [
    {
        key: 'apparel',
        terms: [
            'outfit', 'clothing', 'apparel', 'dress', 'skirt', 'coat', 'pants', 'trousers',
            'suit', 'blazer', 'shirt', 't shirt', 'lookbook', 'wardrobe',
            '穿搭', '服装', '衣服', '裙子', '外套', '裤子', '长裤', '西装', '西装外套', '衬衫', 't恤', '造型'
        ]
    },
    {
        key: 'beauty',
        terms: [
            'skincare', 'skin care', 'cosmetic', 'makeup', 'cream', 'lotion', 'serum',
            'foundation', '护肤', '护肤品', '美妆', '化妆', '彩妆', '面霜', '乳液', '精华', '皮肤'
        ]
    },
    {
        key: 'architecture',
        terms: [
            'architecture', 'architectural', 'building', 'buildings', 'cityscape', 'skyline',
            'urban planning', 'interior', 'exterior', 'diorama', 'scale model', 'model city',
            '建筑', '楼宇', '城市景观', '天际线', '城市规划', '室内', '空间', '沙盘', '建筑模型'
        ]
    },
    {
        key: 'packaging',
        terms: [
            'packaging', 'package', 'box', 'bag', 'label', 'brand system',
            '包装', '包装袋', '礼盒', '纸袋', '标签', '品牌系统'
        ]
    },
    {
        key: 'food',
        terms: [
            'food', 'dish', 'recipe', 'restaurant', 'coffee', 'dessert', 'bakery',
            '食物', '美食', '菜品', '餐厅', '咖啡', '甜点', '烘焙'
        ]
    },
    {
        key: 'poster',
        terms: [
            'poster', 'movie poster', 'album cover', 'cover design', 'graphic poster',
            '海报', '电影海报', '封面', '封面设计'
        ]
    },
    {
        key: 'character',
        terms: [
            'character', 'anime', 'manga', 'mascot', 'game character',
            '角色', '动漫', '二次元', '漫画', '吉祥物', '游戏角色'
        ]
    },
    {
        key: 'vehicle',
        terms: [
            'car', 'vehicle', 'motorcycle', 'bike', 'automotive',
            '汽车', '车辆', '摩托车', '自行车'
        ]
    },
    {
        key: 'landscape',
        terms: [
            'landscape', 'nature', 'travel', 'scenery', 'mountain', 'forest', 'ocean',
            '风景', '自然', '旅行', '山脉', '森林', '海洋'
        ]
    }
];
const PROMPT_RELATED_PROFILE_CACHE = new WeakMap();

function normalizePromptRelatedToken(value = '') {
    return normalizePromptSearchText(value)
        .replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, ' ')
        .trim();
}

function hasPromptRelatedSignal(value = '') {
    const normalized = normalizePromptRelatedToken(value);
    const compact = normalized.replace(/\s+/g, '');
    if (!compact) return false;
    if (PROMPT_RELATED_STOPWORDS.has(normalized) || PROMPT_RELATED_STOPWORDS.has(compact)) return false;
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(compact)) {
        return compact.length >= 2;
    }
    return compact.length >= 3 || compact === '3d' || compact === 'ui' || compact === 'ux';
}

function collectPromptRelatedKeywordValues(item = {}, output = []) {
    collectPromptSearchValues({
        tags: item?.tags,
        aiTags: item?.aiTags || item?.ai_tags,
        keywords: item?.keywords || item?.prompt_keywords || item?.generated_keywords || item?.analysis_keywords
    }, output);
    return output;
}

function getPromptRelatedTokenSet(item = {}) {
    const values = collectPromptRelatedKeywordValues(item, []);
    const tokens = new Set();

    values.forEach((value) => {
        getPromptSearchTokenVariants(value).forEach((token) => {
            const normalized = normalizePromptRelatedToken(token);
            if (normalized && hasPromptRelatedSignal(normalized)) {
                tokens.add(normalized);
            }
        });
    });

    return tokens;
}

function getPromptRelatedTextTokenSet(item = {}) {
    const textValues = collectPromptSearchValues({
        title: item?.title,
        title_en: item?.title_en,
        title_zh: item?.title_zh,
        description: item?.description,
        description_en: item?.description_en,
        description_zh: item?.description_zh,
        prompt: item?.prompt,
        prompt_text: item?.prompt_text,
        prompt_text_en: item?.prompt_text_en,
        prompt_text_zh: item?.prompt_text_zh
    }, []);
    const tokens = new Set();

    textValues.forEach((value) => {
        getPromptSearchTokenVariants(value)
            .map(normalizePromptRelatedToken)
            .filter((token) => token && token.length <= 32 && hasPromptRelatedSignal(token))
            .forEach((token) => tokens.add(token));
    });

    return tokens;
}

function countPromptRelatedTokenOverlap(leftTokens = new Set(), rightTokens = new Set()) {
    let count = 0;
    leftTokens.forEach((token) => {
        if (rightTokens.has(token)) {
            count += 1;
        }
    });
    return count;
}

function getPromptRelatedSetMetrics(leftTokens = new Set(), rightTokens = new Set()) {
    const overlapCount = countPromptRelatedTokenOverlap(leftTokens, rightTokens);
    const unionSize = new Set([...leftTokens, ...rightTokens]).size;
    const smallerSize = Math.min(leftTokens.size || 0, rightTokens.size || 0);
    return {
        overlapCount,
        jaccard: unionSize > 0 ? overlapCount / unionSize : 0,
        coverage: smallerSize > 0 ? overlapCount / smallerSize : 0
    };
}

function getPromptRelatedFacetHaystack(item = {}) {
    return collectPromptSearchValues({
        title: item?.title,
        title_en: item?.title_en,
        title_zh: item?.title_zh,
        description: item?.description,
        description_en: item?.description_en,
        description_zh: item?.description_zh,
        prompt: item?.prompt,
        prompt_text: item?.prompt_text,
        prompt_text_en: item?.prompt_text_en,
        prompt_text_zh: item?.prompt_text_zh,
        tags: item?.tags,
        aiTags: item?.aiTags || item?.ai_tags,
        keywords: item?.keywords || item?.prompt_keywords || item?.generated_keywords || item?.analysis_keywords,
        category: item?.category || item?.prompt_type
    }, []).join(' ');
}

function promptRelatedFacetHaystackHasTerm(haystack = '', term = '') {
    const normalizedHaystack = normalizePromptRelatedToken(haystack);
    const normalizedTerm = normalizePromptRelatedToken(term);
    if (!normalizedHaystack || !normalizedTerm) return false;
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(normalizedTerm)) {
        return normalizedHaystack.replace(/\s+/g, '').includes(normalizedTerm.replace(/\s+/g, ''));
    }
    return promptSearchHaystackMatchesTerm(normalizedHaystack, normalizedTerm);
}

function getPromptRelatedFacetSet(item = {}) {
    const haystack = getPromptRelatedFacetHaystack(item);
    const facets = new Set();
    PROMPT_RELATED_FACET_DEFINITIONS.forEach((definition) => {
        if (definition.terms.some((term) => promptRelatedFacetHaystackHasTerm(haystack, term))) {
            facets.add(definition.key);
        }
    });
    return facets;
}

function havePromptRelatedFacetOverlap(leftFacets = new Set(), rightFacets = new Set()) {
    if (!leftFacets.size && !rightFacets.size) {
        return true;
    }
    if (!leftFacets.size || !rightFacets.size) {
        return false;
    }
    return countPromptRelatedTokenOverlap(leftFacets, rightFacets) > 0;
}

function getPromptRelatedProfile(item = {}) {
    if (item && typeof item === 'object' && PROMPT_RELATED_PROFILE_CACHE.has(item)) {
        return PROMPT_RELATED_PROFILE_CACHE.get(item);
    }

    const category = normalizePromptRelatedToken(item?.category || item?.prompt_type || '');
    const profile = {
        structuredTokens: getPromptRelatedTokenSet(item),
        textTokens: getPromptRelatedTextTokenSet(item),
        facets: getPromptRelatedFacetSet(item),
        category
    };

    if (item && typeof item === 'object') {
        PROMPT_RELATED_PROFILE_CACHE.set(item, profile);
    }

    return profile;
}

function getPromptIdentityKeys(item = {}) {
    return new Set([
        item?.id,
        item?.supabaseId,
        item?.supabase_id
    ].map((value) => String(value ?? '').trim()).filter(Boolean));
}

function getPromptRelatedScoreDetails(baseItem = {}, candidate = {}) {
    const baseIds = getPromptIdentityKeys(baseItem);
    const candidateIds = getPromptIdentityKeys(candidate);
    if ([...candidateIds].some((id) => baseIds.has(id))) {
        return { score: -Infinity };
    }

    const baseProfile = getPromptRelatedProfile(baseItem);
    const candidateProfile = getPromptRelatedProfile(candidate);
    if (!havePromptRelatedFacetOverlap(baseProfile.facets, candidateProfile.facets)) {
        return { score: -Infinity };
    }

    const structuredMetrics = getPromptRelatedSetMetrics(baseProfile.structuredTokens, candidateProfile.structuredTokens);
    const textMetrics = getPromptRelatedSetMetrics(baseProfile.textTokens, candidateProfile.textTokens);
    const keywordTextOverlapCount = countPromptRelatedTokenOverlap(baseProfile.structuredTokens, candidateProfile.textTokens);
    const textKeywordOverlapCount = countPromptRelatedTokenOverlap(baseProfile.textTokens, candidateProfile.structuredTokens);
    const keywordBridgeCount = keywordTextOverlapCount + textKeywordOverlapCount;
    const totalEvidenceCount = structuredMetrics.overlapCount + keywordBridgeCount + textMetrics.overlapCount;

    let score = 0;
    score += structuredMetrics.overlapCount * 10;
    score += keywordTextOverlapCount * 2;
    score += textKeywordOverlapCount * 2;
    score += textMetrics.overlapCount;
    score += Math.round(structuredMetrics.jaccard * 30);
    score += Math.round(structuredMetrics.coverage * 18);
    score += Math.round(textMetrics.jaccard * 8);

    const sameCategory = Boolean(baseProfile.category && candidateProfile.category && baseProfile.category === candidateProfile.category);
    if (sameCategory) {
        score += 6;
    }

    if (getPromptImageAssets(candidate).length > 0) {
        score += 0.5;
    }

    return {
        score,
        keywordOverlapCount: structuredMetrics.overlapCount,
        keywordTextOverlapCount,
        textKeywordOverlapCount,
        textOverlapCount: textMetrics.overlapCount,
        sameCategory,
        keywordBridgeCount,
        totalEvidenceCount,
        structuredJaccard: structuredMetrics.jaccard,
        structuredCoverage: structuredMetrics.coverage,
        textJaccard: textMetrics.jaccard
    };
}

function scoreRelatedPromptCandidate(baseItem = {}, candidate = {}) {
    return getPromptRelatedScoreDetails(baseItem, candidate).score;
}

function isPromptRelatedCandidateStrongEnough(details = {}) {
    const score = Number(details.score);
    if (!Number.isFinite(score)) return false;

    const structuredOverlapCount = details.keywordOverlapCount || 0;
    const keywordBridgeCount = details.keywordBridgeCount || 0;
    const totalEvidenceCount = details.totalEvidenceCount || 0;
    const hasEnoughStructuredOverlap = structuredOverlapCount >= PROMPT_RELATED_MIN_STRUCTURED_OVERLAPS;
    const hasEnoughRatio = (details.structuredJaccard || 0) >= PROMPT_RELATED_MIN_STRUCTURED_JACCARD
        || (details.structuredCoverage || 0) >= PROMPT_RELATED_MIN_STRUCTURED_COVERAGE;
    const hasEnoughEvidence = totalEvidenceCount >= PROMPT_RELATED_MIN_TOTAL_EVIDENCE;
    const hasCategoryBridge = Boolean(details.sameCategory && structuredOverlapCount >= 3 && keywordBridgeCount >= 2);
    const hasStrongKeywordBridge = Boolean(structuredOverlapCount >= 3 && keywordBridgeCount >= PROMPT_RELATED_MIN_BRIDGE_OVERLAPS);

    return hasEnoughStructuredOverlap
        && hasEnoughRatio
        && hasEnoughEvidence
        && (hasCategoryBridge || hasStrongKeywordBridge || structuredOverlapCount >= 5)
        && score >= PROMPT_RELATED_MIN_SCORE;
}

function getRelatedPrompts(currentItem = {}, limit = 12) {
    if (!Array.isArray(PROMPTS) || PROMPTS.length === 0 || !currentItem) {
        return [];
    }

    const scored = PROMPTS
        .filter((item) => item && getPromptImageAssets(item).length > 0)
        .map((item, index) => ({
            item,
            index,
            details: getPromptRelatedScoreDetails(currentItem, item)
        }))
        .map((entry) => ({
            ...entry,
            score: entry.details.score
        }))
        .filter((entry) => isPromptRelatedCandidateStrongEnough(entry.details))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return (Number(b.item?.id) || b.index) - (Number(a.item?.id) || a.index);
        });

    return scored.slice(0, limit).map((entry) => entry.item);
}

let lastRenderedRelatedPromptKey = '';

function getRelatedPromptRenderKey(item = findPromptAnalyticsItem()) {
    const promptId = getPromptStableOpenId(item) || String(currentPromptId ?? '').trim();
    const detailState = item?.promptDetailLoaded ? 'detail' : 'summary';
    return `${promptId}:${detailState}`;
}

function getRelatedPromptImageUrl(item = {}) {
    const asset = getPromptPrimaryImageAsset(item);
    if (!asset) return '';
    return getOptimizedImageUrl(asset, { variant: 'card' })
        || getOptimizedImageUrl(asset, { variant: 'thumb' })
        || getPromptModalImageUrl(asset);
}

const RELATED_PROMPT_CARD_LAYOUTS = [
    { className: 'related-prompt-card--hero', heightWeight: 1.52 },
    { className: 'related-prompt-card--wide', heightWeight: 0.78 },
    { className: 'related-prompt-card--portrait', heightWeight: 1.28 },
    { className: 'related-prompt-card--square', heightWeight: 1 }
];
const RELATED_PROMPT_CARD_GAP_WEIGHT = 0.12;
const RELATED_PROMPT_COLUMN_STAGGER_WEIGHT = 0.18;
const RELATED_MODE_MOBILE_RENDER_DELAY_MS = 180;
const RELATED_PROMPT_INITIAL_IMAGE_COUNT = 4;
const RELATED_PROMPT_IMAGE_ROOT_MARGIN_PX = 240;
let promptRelatedModeRenderTimerId = null;
let promptRelatedModePendingItem = null;
let promptRelatedGridEntryFrameId = null;
let promptRelatedGridEntryTimerId = null;
let promptRelatedImageObserver = null;

function getRelatedPromptCardLayout(index = 0) {
    return RELATED_PROMPT_CARD_LAYOUTS[index % RELATED_PROMPT_CARD_LAYOUTS.length] || RELATED_PROMPT_CARD_LAYOUTS[0];
}

function getRelatedPromptCardAspectWeight(index = 0) {
    return getRelatedPromptCardLayout(index).heightWeight;
}

function getRelatedPromptTargetColumnIndex(columnHeights = []) {
    return columnHeights[0] <= columnHeights[1] ? 0 : 1;
}

function buildRelatedPromptCardMarkup(item = {}, index = 0) {
    const title = getLocalizedField(item, 'title') || item.title || '';
    const imageUrl = getRelatedPromptImageUrl(item);
    const aspectClass = ` ${getRelatedPromptCardLayout(index).className}`;
    const promptId = getPromptStableOpenId(item);
    const shouldLoadImage = index < RELATED_PROMPT_INITIAL_IMAGE_COUNT;
    const imageSourceAttribute = shouldLoadImage
        ? `src="${escapeHtml(imageUrl)}"`
        : `data-related-image-src="${escapeHtml(imageUrl)}" fetchpriority="low"`;
    return `
        <button class="related-prompt-card${aspectClass}" type="button" data-related-prompt-id="${escapeHtml(promptId)}" aria-label="${escapeHtml(title)}">
            ${imageUrl ? `<img class="related-prompt-card__image" ${imageSourceAttribute} alt="${escapeHtml(title)}" loading="lazy" decoding="async" draggable="false">` : '<span class="related-prompt-card__fallback" aria-hidden="true"></span>'}
            <span class="related-prompt-card__shade" aria-hidden="true"></span>
            <span class="related-prompt-card__title">${escapeHtml(title)}</span>
        </button>
    `;
}

function clearRelatedPromptImageObserver() {
    promptRelatedImageObserver?.disconnect();
    promptRelatedImageObserver = null;
}

function activateRelatedPromptImage(image) {
    if (!image) return;

    const imageUrl = String(image.dataset.relatedImageSrc || '').trim();
    if (!imageUrl) return;
    delete image.dataset.relatedImageSrc;
    image.src = imageUrl;
}

function observeDeferredRelatedPromptImages(grid) {
    clearRelatedPromptImageObserver();
    const deferredImages = Array.from(grid?.querySelectorAll('img[data-related-image-src]') || []);
    if (!deferredImages.length) return;

    if (typeof window.IntersectionObserver !== 'function') {
        deferredImages.forEach(activateRelatedPromptImage);
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            activateRelatedPromptImage(entry.target);
            observer.unobserve(entry.target);
        });
    }, {
        root: grid,
        rootMargin: `${RELATED_PROMPT_IMAGE_ROOT_MARGIN_PX}px 0px`,
        threshold: 0.01
    });
    promptRelatedImageObserver = observer;
    deferredImages.forEach((image) => observer.observe(image));
}

function prepareRelatedPromptCardImages(grid) {
    if (!grid) return;

    grid.querySelectorAll('.related-prompt-card img').forEach((image) => {
        disablePromptImageDrag(image);
        const revealImage = () => image.classList.add('is-loaded');
        if (image.complete && image.naturalWidth > 0) {
            revealImage();
            return;
        }
        if (image.dataset.relatedImageRevealBound === '1') return;
        image.dataset.relatedImageRevealBound = '1';
        image.addEventListener('load', revealImage, { once: true });
    });
    observeDeferredRelatedPromptImages(grid);
}

function renderRelatedPrompts(item = findPromptAnalyticsItem()) {
    const grid = document.getElementById('relatedPromptGrid');
    if (!grid) return;

    const renderKey = getRelatedPromptRenderKey(item);
    if (renderKey && renderKey === lastRenderedRelatedPromptKey && grid.children.length > 0) {
        prepareRelatedPromptCardImages(grid);
        return;
    }
    lastRenderedRelatedPromptKey = renderKey;
    clearRelatedPromptImageObserver();

    const relatedItems = getRelatedPrompts(item, 14);
    if (!relatedItems.length) {
        const isEnglish = getCurrentLanguage() === 'en';
        grid.classList.add('related-prompt-grid--empty');
        grid.innerHTML = `
            <div class="related-empty-state">
                <div class="related-empty-title">${window.i18n?.t('gallery.sameStyleEmpty') || (isEnglish ? 'No same-style prompts yet' : '暂时没有相同风格')}</div>
                <div class="related-empty-subtitle">${window.i18n?.t('gallery.sameStyleEmptySub') || (isEnglish ? 'Try another prompt.' : '换一个提示词看看。')}</div>
            </div>
        `;
        return;
    }

    grid.classList.remove('related-prompt-grid--empty');
    const columns = [[], []];
    const columnHeights = [0, RELATED_PROMPT_COLUMN_STAGGER_WEIGHT];
    relatedItems.forEach((relatedItem, index) => {
        const targetColumnIndex = getRelatedPromptTargetColumnIndex(columnHeights);
        columns[targetColumnIndex].push(buildRelatedPromptCardMarkup(relatedItem, index));
        columnHeights[targetColumnIndex] += getRelatedPromptCardAspectWeight(index) + RELATED_PROMPT_CARD_GAP_WEIGHT;
    });
    grid.innerHTML = columns.map((items, index) => `
        <div class="related-prompt-column related-prompt-column--${index === 0 ? 'left' : 'right'}">
            ${items.join('')}
        </div>
    `).join('');
    prepareRelatedPromptCardImages(grid);
    grid.querySelectorAll('.related-prompt-card').forEach((card) => {
        card.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const relatedId = card.dataset.relatedPromptId;
            const relatedPrompt = PROMPTS.find((prompt) => (
                String(prompt?.supabaseId ?? '').trim() === relatedId
                || String(prompt?.supabase_id ?? '').trim() === relatedId
                || String(prompt?.id ?? '').trim() === relatedId
            ));
            if (relatedPrompt) {
                openPromptModal(getPromptStableOpenId(relatedPrompt), { animateRelatedSelection: true });
            }
        });
    });
}

function clearRelatedPromptGridEntryAnimation() {
    if (promptRelatedGridEntryFrameId) {
        cancelAnimationFrame(promptRelatedGridEntryFrameId);
        promptRelatedGridEntryFrameId = null;
    }
    if (promptRelatedGridEntryTimerId) {
        clearTimeout(promptRelatedGridEntryTimerId);
        promptRelatedGridEntryTimerId = null;
    }
    document.getElementById('relatedPromptGrid')?.classList.remove('related-prompt-grid--entering');
}

function cancelScheduledRelatedPromptRender() {
    if (promptRelatedRenderFrameId) {
        cancelAnimationFrame(promptRelatedRenderFrameId);
        promptRelatedRenderFrameId = null;
    }
    if (promptRelatedRenderTimerId) {
        clearTimeout(promptRelatedRenderTimerId);
        promptRelatedRenderTimerId = null;
    }
    promptRelatedRenderToken += 1;
}

function cancelRelatedPromptWarmup() {
    if (promptRelatedWarmupIdleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(promptRelatedWarmupIdleId);
    }
    if (promptRelatedWarmupTimerId) {
        clearTimeout(promptRelatedWarmupTimerId);
    }
    promptRelatedWarmupIdleId = null;
    promptRelatedWarmupTimerId = null;
}

function cancelRelatedPromptWork() {
    cancelScheduledRelatedPromptRender();
    cancelRelatedPromptWarmup();
    clearRelatedModeDeferredRender();
    clearRelatedPromptImageObserver();
}

function scheduleRelatedPromptsRender(item = findPromptAnalyticsItem()) {
    cancelRelatedPromptWarmup();
    cancelScheduledRelatedPromptRender();
    const token = promptRelatedRenderToken;
    const shouldDelayFirstRender = isPromptModalMobileLayout() && !isRelatedPromptRenderReady(item);
    const render = () => {
        promptRelatedRenderTimerId = null;
        if (token !== promptRelatedRenderToken || !isRelatedMode) return;
        promptRelatedRenderFrameId = requestAnimationFrame(() => {
            promptRelatedRenderFrameId = null;
            if (token !== promptRelatedRenderToken || !isRelatedMode) return;
            renderRelatedPrompts(item);
            playRelatedPromptGridEntryAnimation();
        });
    };

    if (shouldDelayFirstRender) {
        promptRelatedRenderTimerId = window.setTimeout(render, 90);
        return;
    }

    promptRelatedRenderFrameId = requestAnimationFrame(render);
}

function isRelatedPromptRenderReady(item = findPromptAnalyticsItem()) {
    const grid = document.getElementById('relatedPromptGrid');
    const renderKey = getRelatedPromptRenderKey(item);
    return Boolean(renderKey && grid?.children.length > 0 && renderKey === lastRenderedRelatedPromptKey);
}

function warmRelatedPromptImages(limit = RELATED_PROMPT_INITIAL_IMAGE_COUNT) {
    const grid = document.getElementById('relatedPromptGrid');
    if (!grid) return;

    getRelatedPromptImagesInVisualOrder(grid)
        .slice(0, limit)
        .forEach((image) => {
            activateRelatedPromptImage(image);
            if (typeof image.decode === 'function') {
                image.decode().catch(() => {});
            }
        });
}

function getRelatedPromptImagesInVisualOrder(grid) {
    if (!grid) return [];

    const columnImages = Array.from(grid.querySelectorAll('.related-prompt-column')).map((column) => (
        Array.from(column.querySelectorAll('.related-prompt-card img'))
    ));
    const rowCount = Math.max(0, ...columnImages.map((images) => images.length));
    const orderedImages = [];

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        columnImages.forEach((images) => {
            const image = images[rowIndex];
            if (image) orderedImages.push(image);
        });
    }

    return orderedImages;
}

function warmRelatedPromptsForModal(item = findPromptAnalyticsItem()) {
    const token = promptRelatedRenderToken;
    requestAnimationFrame(() => {
        if (token !== promptRelatedRenderToken || isPromptDetailSideModeActive()) return;
        renderRelatedPrompts(item);
        requestAnimationFrame(() => {
            if (token !== promptRelatedRenderToken) return;
            warmRelatedPromptImages();
        });
    });
}

function scheduleRelatedPromptWarmup(item = findPromptAnalyticsItem()) {
    cancelRelatedPromptWarmup();
    const token = promptRelatedRenderToken;
    const run = () => {
        promptRelatedWarmupIdleId = null;
        promptRelatedWarmupTimerId = null;
        if (token !== promptRelatedRenderToken || isPromptDetailSideModeActive()) return;
        warmRelatedPromptsForModal(item);
    };

    if (typeof window.requestIdleCallback === 'function') {
        promptRelatedWarmupIdleId = window.requestIdleCallback(run, { timeout: 320 });
        return;
    }

    promptRelatedWarmupTimerId = window.setTimeout(run, 120);
}

function playRelatedPromptGridEntryAnimation(options = {}) {
    const grid = document.getElementById('relatedPromptGrid');
    if (!grid || grid.classList.contains('related-prompt-grid--empty')) return;

    clearRelatedPromptGridEntryAnimation();
    const frameDelay = Math.max(1, Math.floor(Number(options.frameDelay) || 1));
    const isMobileLayout = isPromptModalMobileLayout();
    const columns = Array.from(grid.querySelectorAll('.related-prompt-column'));
    columns.forEach((column, columnIndex) => {
        Array.from(column.querySelectorAll('.related-prompt-card')).forEach((card, rowIndex) => {
            const rowDelay = rowIndex * (isMobileLayout ? 32 : 12);
            const columnDrift = columnIndex * (isMobileLayout ? 16 : 8);
            const organicOffset = ((rowIndex + columnIndex) % 3) * (isMobileLayout ? 5 : 3);
            const delay = Math.min(rowDelay + columnDrift + organicOffset, isMobileLayout ? 220 : 80);
            const yOffset = 7 + Math.min(rowIndex, 3);
            card.style.setProperty('--related-card-enter-delay', `${delay}ms`);
            card.style.setProperty('--related-card-enter-y', `${yOffset}px`);
        });
    });

    const scheduleEntryFrame = (remainingFrames) => {
        promptRelatedGridEntryFrameId = requestAnimationFrame(() => {
            if (!grid.isConnected || !isRelatedMode) {
                promptRelatedGridEntryFrameId = null;
                return;
            }
            if (remainingFrames > 1) {
                scheduleEntryFrame(remainingFrames - 1);
                return;
            }

            promptRelatedGridEntryFrameId = null;
            grid.classList.add('related-prompt-grid--entering');
            promptRelatedGridEntryTimerId = setTimeout(() => {
                grid.classList.remove('related-prompt-grid--entering');
                promptRelatedGridEntryTimerId = null;
            }, isMobileLayout ? 820 : 520);
        });
    };
    scheduleEntryFrame(frameDelay);
}

function clearRelatedModeDeferredRender() {
    if (promptRelatedModeRenderTimerId) {
        clearTimeout(promptRelatedModeRenderTimerId);
        promptRelatedModeRenderTimerId = null;
    }
    promptRelatedModePendingItem = null;
    clearRelatedPromptGridEntryAnimation();
    document.querySelector('#promptModal .modal-inner')?.classList.remove('related-mode-entering');
}

function renderRelatedPromptsForActiveMode(item = findPromptAnalyticsItem(), options = {}) {
    if (!isRelatedMode) {
        clearRelatedModeDeferredRender();
        return;
    }

    const modalInner = document.querySelector('#promptModal .modal-inner');
    const grid = document.getElementById('relatedPromptGrid');
    const shouldDeferMobileRender = isPromptModalMobileLayout()
        && (options.forceDefer || promptRelatedModeRenderTimerId || !grid?.children.length);

    if (shouldDeferMobileRender) {
        promptRelatedModePendingItem = item;
        modalInner?.classList.add('related-mode-entering');
        if (promptRelatedModeRenderTimerId) return;

        promptRelatedModeRenderTimerId = setTimeout(() => {
            const pendingItem = promptRelatedModePendingItem || item;
            promptRelatedModeRenderTimerId = null;
            promptRelatedModePendingItem = null;
            if (!isRelatedMode) {
                modalInner?.classList.remove('related-mode-entering');
                return;
            }
            renderRelatedPrompts(pendingItem);
            playRelatedPromptGridEntryAnimation();
            requestAnimationFrame(() => {
                if (isRelatedMode) {
                    modalInner?.classList.remove('related-mode-entering');
                }
            });
        }, RELATED_MODE_MOBILE_RENDER_DELAY_MS);
        return;
    }

    clearRelatedModeDeferredRender();
    if (!isRelatedPromptRenderReady(item)) {
        scheduleRelatedPromptsRender(item);
        return;
    }

    renderRelatedPrompts(item);
    if (options.animateEntry) {
        playRelatedPromptGridEntryAnimation({
            frameDelay: isPromptModalMobileLayout() ? 1 : 2
        });
    }
}

function setPromptCommentTriggerActive(active = false) {
    const triggerBtn = document.getElementById('commentTriggerBtn');
    if (!triggerBtn) return;

    triggerBtn.classList.toggle('active', !!active);
    const icon = triggerBtn.querySelector('i');
    if (icon) icon.className = 'fas fa-comment-dots';
}

function setPromptRelatedTriggerActive(active = false) {
    const triggerBtn = document.getElementById('relatedTriggerBtn');
    if (!triggerBtn) return;

    triggerBtn.classList.toggle('active', !!active);
    triggerBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function syncPromptRelatedTriggerLabel() {
    const triggerBtn = document.getElementById('relatedTriggerBtn');
    if (!triggerBtn) return;

    const label = getPromptRelatedActionLabel();
    triggerBtn.setAttribute('aria-label', label);
    triggerBtn.setAttribute('data-tooltip', label);
}

function resetPromptDetailSideModeButtons() {
    setPromptCommentTriggerActive(false);
    setPromptRelatedTriggerActive(false);
}

function cancelPromptAreaMotion({ resetStyles = true } = {}) {
    if (promptAreaMotionFrameId !== null) {
        cancelAnimationFrame(promptAreaMotionFrameId);
        promptAreaMotionFrameId = null;
    }
    if (promptAreaMotionTimerId !== null) {
        clearTimeout(promptAreaMotionTimerId);
        promptAreaMotionTimerId = null;
    }

    document.querySelector('#promptModal .modal-image-col img')?.classList.remove('blur-motion');
    if (!resetStyles) return;

    const promptArea = document.getElementById('promptArea');
    promptArea?.classList.remove('returning');
    setPromptsCssVars(promptArea, {
        animation: null,
        transition: null,
        transform: null,
        'transform-origin': null,
        'will-change': null
    });
}

function prepareDesktopRelatedSelectionPromptArea(promptArea) {
    if (!promptArea?.classList.contains('docked')) return false;

    cancelPromptAreaMotion();
    setPromptsCssVars(promptArea, {
        animation: 'none',
        transition: 'none',
        transform: null,
        'will-change': 'transform'
    });
    return true;
}

function animateDesktopRelatedSelectionPromptArea(promptArea, prepared) {
    if (!promptArea || !prepared) return;

    setPromptsCssVars(promptArea, {
        transform: `translate3d(0, -${PROMPT_DESKTOP_RELATED_SELECTION_OFFSET_PX}px, 0)`
    });
    void promptArea.offsetWidth;

    promptAreaMotionFrameId = requestAnimationFrame(() => {
        promptAreaMotionFrameId = null;
        setPromptsCssVars(promptArea, {
            transition: `transform ${PROMPT_DESKTOP_RELATED_SELECTION_MOTION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            transform: 'translate3d(0, 0, 0)'
        });

        promptAreaMotionTimerId = window.setTimeout(() => {
            promptAreaMotionTimerId = null;
            setPromptsCssVars(promptArea, {
                animation: null,
                transition: null,
                transform: null,
                'transform-origin': null,
                'will-change': null
            });
        }, PROMPT_DESKTOP_RELATED_SELECTION_MOTION_MS + 50);
    });
}

function movePromptAreaToDetailColumn() {
    const promptArea = document.getElementById('promptArea');
    const contentCol = document.querySelector('.modal-content-col');
    const commentSection = document.getElementById('commentSection');
    if (!promptArea || !contentCol) {
        return;
    }

    cancelPromptAreaMotion();
    promptArea.classList.remove('docked');
    syncModalImageThumbnailPlacement();
    setPromptsCssVars(promptArea, {
        animation: null,
        transition: null,
        transform: null,
        'transform-origin': null
    });
    if (promptArea.parentNode !== contentCol) {
        contentCol.insertBefore(promptArea, commentSection);
    }
}

function dockPromptAreaWithoutAnimation() {
    const promptArea = document.getElementById('promptArea');
    const dockTarget = document.getElementById('promptDockTarget');
    if (!promptArea || !dockTarget || promptArea.parentNode === dockTarget) {
        return;
    }

    cancelPromptAreaMotion();
    setPromptsCssVars(promptArea, {
        animation: 'none',
        transition: 'none',
        transform: null,
        'transform-origin': null
    });
    dockTarget.appendChild(promptArea);
    promptArea.classList.add('docked');
    scheduleModalImageThumbnailPlacementSync();
}

function animatePromptAreaHorizontalSettle(promptArea, {
    offsetX,
    durationMs
} = {}) {
    if (!promptArea || !Number.isFinite(offsetX) || !Number.isFinite(durationMs)) return;

    setPromptsCssVars(promptArea, {
        animation: 'none',
        transition: 'none',
        transform: `translate3d(${offsetX}px, 0, 0)`,
        'transform-origin': null,
        'will-change': 'transform'
    });
    void promptArea.offsetWidth;

    promptAreaMotionFrameId = requestAnimationFrame(() => {
        promptAreaMotionFrameId = null;
        setPromptsCssVars(promptArea, {
            transition: `transform ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            transform: 'translate3d(0, 0, 0)'
        });

        const img = document.querySelector('.modal-image-col img');
        if (img) img.classList.add('blur-motion');

        promptAreaMotionTimerId = window.setTimeout(() => {
            promptAreaMotionTimerId = null;
            setPromptsCssVars(promptArea, {
                animation: null,
                transition: null,
                transform: null,
                'transform-origin': null,
                'will-change': null
            });
            if (img) img.classList.remove('blur-motion');
            scheduleModalImageThumbnailPlacementSync();
        }, durationMs + 50);
    });
}

function animatePromptAreaToDock() {
    const promptArea = document.getElementById('promptArea');
    const dockTarget = document.getElementById('promptDockTarget');
    if (!promptArea || !dockTarget) return;

    cancelPromptAreaMotion();
    setPromptsCssVars(promptArea, {
        animation: 'none',
        transition: 'none',
        transform: null
    });
    dockTarget.appendChild(promptArea);
    promptArea.classList.add('docked');
    scheduleModalImageThumbnailPlacementSync();
    animatePromptAreaHorizontalSettle(promptArea, {
        offsetX: PROMPT_DESKTOP_SIDE_MODE_PROMPT_OFFSET_PX,
        durationMs: PROMPT_DESKTOP_SIDE_MODE_PROMPT_MOTION_MS
    });
}

function animatePromptAreaFromDock() {
    const promptArea = document.getElementById('promptArea');
    if (!promptArea) return;

    movePromptAreaToDetailColumn();
    animatePromptAreaHorizontalSettle(promptArea, {
        offsetX: -PROMPT_DESKTOP_SIDE_MODE_PROMPT_OFFSET_PX,
        durationMs: PROMPT_DESKTOP_SIDE_MODE_PROMPT_MOTION_MS
    });
}

function clearPromptDetailSideMode({ resetButtons = true, resetClasses = true, releaseGeometry = true } = {}) {
    isCommentMode = false;
    isRelatedMode = false;
    cancelRelatedPromptWork();
    setCommentSortDropdownOpen(false);
    closePromptCommentInputDock();
    if (releaseGeometry) {
        releasePromptModalCommentModeGeometry();
    }
    resetPromptModalKeyboardDockIfNeeded(false);
    if (resetClasses) {
        const modalInner = document.querySelector('#promptModal .modal-inner');
        clearPromptCommentModeReturnState(modalInner);
        modalInner?.classList.remove('comment-mode', 'related-mode', 'related-mode-entering');
        syncModalImageThumbnailPlacement();
    }
    if (resetButtons) {
        resetPromptDetailSideModeButtons();
    }
    syncPromptModalTopButtonState();
}

function syncPromptModalLayoutModeAfterBreakpointChange() {
    promptModalLayoutSyncFrameId = null;

    const modal = document.getElementById('promptModal');
    const modalInner = modal?.querySelector('.modal-inner');
    if (!modal?.classList.contains('active') || !modalInner || !isPromptDetailSideModeActive()) {
        promptModalLayoutWasMobile = isPromptModalMobileLayout();
        return;
    }

    const isMobileLayout = isPromptModalMobileLayout();
    if (isMobileLayout) {
        releasePromptModalCommentModeGeometry();
        movePromptAreaToDetailColumn();
        lockPromptModalCommentModeGeometry({ force: true, defer: true });
        return;
    }

    releasePromptModalCommentModeGeometry();
    dockPromptAreaWithoutAnimation();
}

function requestPromptModalLayoutModeSync() {
    const isMobileLayout = isPromptModalMobileLayout();
    if (promptModalLayoutWasMobile === null) {
        promptModalLayoutWasMobile = isMobileLayout;
        return;
    }
    if (promptModalLayoutWasMobile === isMobileLayout) return;

    promptModalLayoutWasMobile = isMobileLayout;
    if (promptModalLayoutSyncFrameId) return;
    promptModalLayoutSyncFrameId = requestAnimationFrame(syncPromptModalLayoutModeAfterBreakpointChange);
}

function renderPromptModalSourceActions(item = {}) {
    const actions = document.getElementById('promptModalSourceActions');
    if (!actions) {
        return;
    }

    const favoriteId = getPromptFavoriteIdForItem(item);
    actions.innerHTML = `
        <div class="card-source-actions prompt-modal-card-source-actions">
            ${buildPromptSourceLinkMarkup(item)}
            ${buildPromptFavoriteClusterMarkup(item, { favoriteId })}
        </div>
    `;
    bindPromptSourceActionEvents(actions, favoriteId);
    renderPromptHeaderShareAction(item);
}

function setPromptFavoriteAuthUser(user = null, options = {}) {
    const nextUserId = normalizePromptFavoriteUserId(user?.id || '');
    if (!options.force && nextUserId === promptFavoriteAuthUserId) {
        return;
    }

    promptFavoriteAuthUserId = nextUserId;
    promptFavoriteMutationVersion += 1;
    if (promptFavoriteAuthUserId) {
        migrateLegacyPromptFavorites(promptFavoriteAuthUserId);
        favorites = new Set(getStoredPromptFavorites());
        void hydratePromptFavoriteCloudState();
    } else {
        favorites = new Set();
    }

    if (options.rerender === true && promptGalleryHasRendered && Array.isArray(PROMPTS) && PROMPTS.length > 0) {
        renderGallery(currentFilter || 'all', false);
        return;
    }
    syncPromptFavoriteButtons();
}

async function syncPromptFavoriteAuthState(options = {}) {
    if (!window.supabaseClient?.auth?.getUser) {
        setPromptFavoriteAuthUser(null, options);
        return null;
    }

    try {
        const { data: { user } = {} } = await window.supabaseClient.auth.getUser();
        setPromptFavoriteAuthUser(user || null, options);
        return user || null;
    } catch (error) {
        console.warn('Failed to sync prompt favorite auth state:', error);
        setPromptFavoriteAuthUser(null, options);
        return null;
    }
}

function bindPromptFavoriteAuthListener() {
    if (promptFavoriteAuthListenerBound || !window.supabaseClient?.auth?.onAuthStateChange) {
        return;
    }
    promptFavoriteAuthListenerBound = true;
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
            setPromptFavoriteAuthUser(session?.user || null, { rerender: true });
        } else if (event === 'SIGNED_OUT') {
            setPromptFavoriteAuthUser(null, { rerender: true });
        }
    });
}

function normalizePromptSourceLink(value = '') {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';

    try {
        const parsed = new URL(rawValue, window.location.origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
    } catch (_) {
        return '';
    }

    return '';
}

function getPromptSourceAttribution(item = {}) {
    const sourceUrl = normalizePromptSourceLink(item.sourceUrl || item.source_url || '');
    const authorName = String(item.sourceAuthorName || item.source_author_name || '').trim();
    const authorHandle = String(item.sourceAuthorHandle || item.source_author_handle || '').trim();

    return {
        sourceUrl,
        authorName,
        authorHandle,
        hasAttribution: Boolean(sourceUrl || authorName || authorHandle)
    };
}

function buildPromptSourceAttributionMarkup(item = {}) {
    const attribution = getPromptSourceAttribution(item);
    const hasAuthorIdentity = Boolean(attribution.authorName || attribution.authorHandle);
    if (!hasAuthorIdentity) {
        return '<span class="card-source-empty" aria-hidden="true"></span>';
    }

    const authorName = attribution.authorName || attribution.authorHandle.replace(/^@+/, '') || 'Original creator';
    const authorHandle = attribution.authorHandle
        ? (attribution.authorHandle.startsWith('@') ? attribution.authorHandle : `@${attribution.authorHandle}`)
        : '';
    return `
        <div class="card-source-author">
            <span class="card-source-copy">
                <span class="card-source-name">${escapeHtml(authorName)}</span>
                ${authorHandle ? `<span class="card-source-handle">${escapeHtml(authorHandle)}</span>` : ''}
            </span>
        </div>
    `;
}

const PROMPT_CARD_TOUCH_TAP_MAX_DISTANCE = 10;
const PROMPT_CARD_TOUCH_CLICK_SUPPRESS_MS = 700;
const PROMPT_CARD_INTERACTIVE_SELECTOR = [
    'a',
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '.card-source-link',
    '.card-fav-btn'
].join(', ');

function isPromptCardTouchPointer(event) {
    return String(event?.pointerType || '') === 'touch';
}

function isPromptCardInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(PROMPT_CARD_INTERACTIVE_SELECTOR));
}

function suppressPromptCardFollowupClick(card) {
    if (!card) return;
    card._promptCardSuppressClickUntil = Date.now() + PROMPT_CARD_TOUCH_CLICK_SUPPRESS_MS;
}

function shouldSuppressPromptCardClick(card) {
    return Boolean(card?._promptCardSuppressClickUntil && Date.now() < card._promptCardSuppressClickUntil);
}

function bindPromptCardActivation(card, promptId) {
    if (!card) return;

    card.onclick = (event) => {
        if (shouldSuppressPromptCardClick(card)) {
            event?.preventDefault();
            return;
        }
        openPromptModal(promptId);
    };

    if (typeof window.PointerEvent === 'undefined') return;

    let touchTapState = null;

    card.addEventListener('pointerdown', (event) => {
        if (!isPromptCardTouchPointer(event) || isPromptCardInteractiveTarget(event.target)) {
            touchTapState = null;
            return;
        }

        touchTapState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false
        };
    });

    card.addEventListener('pointermove', (event) => {
        if (!touchTapState || event.pointerId !== touchTapState.pointerId) return;

        const dx = event.clientX - touchTapState.startX;
        const dy = event.clientY - touchTapState.startY;
        if (Math.hypot(dx, dy) > PROMPT_CARD_TOUCH_TAP_MAX_DISTANCE) {
            touchTapState.moved = true;
        }
    });

    card.addEventListener('pointerup', (event) => {
        if (!touchTapState || event.pointerId !== touchTapState.pointerId) return;

        const tapState = touchTapState;
        touchTapState = null;

        const dx = event.clientX - tapState.startX;
        const dy = event.clientY - tapState.startY;
        const moved = tapState.moved || Math.hypot(dx, dy) > PROMPT_CARD_TOUCH_TAP_MAX_DISTANCE;

        if (moved || isPromptCardInteractiveTarget(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        suppressPromptCardFollowupClick(card);
        openPromptModal(promptId);
    });

    card.addEventListener('pointercancel', () => {
        touchTapState = null;
    });
}

// --- Render Gallery ---
function promptMatchesMediaFilter(item, mediaFilter = currentPromptMediaFilter) {
    const normalizedFilter = ['image', 'video'].includes(mediaFilter) ? mediaFilter : 'image';

    const hasVideo = getPromptVideoAssets(item).length > 0;
    if (normalizedFilter === 'video') return hasVideo;
    return !hasVideo && getPromptImageAssets(item).length > 0;
}

function applyPromptMediaFilter(items = promptGalleryBaseFilteredItems) {
    return (Array.isArray(items) ? items : []).filter((item) => (
        promptMatchesMediaFilter(item, currentPromptMediaFilter)
    ));
}

function getPromptSortKey(item = {}) {
    return String(item.supabaseId ?? item.supabase_id ?? item.id ?? '').trim();
}

function getPromptRandomOrderKey(item = {}) {
    const key = getPromptSortKey(item);
    if (!promptRandomOrderKeys.has(key)) {
        promptRandomOrderKeys.set(key, Math.random());
    }
    return promptRandomOrderKeys.get(key);
}

function comparePromptStableIds(a = {}, b = {}) {
    return getPromptSortKey(a).localeCompare(getPromptSortKey(b), undefined, {
        numeric: true,
        sensitivity: 'base'
    });
}

function applyPromptSort(items = []) {
    const sortedItems = [...(Array.isArray(items) ? items : [])];
    if (currentPromptSort === 'hot') {
        return sortedItems.sort((a, b) => {
            const aMetrics = promptHotnessMetrics.get(getPromptSortKey(a));
            const bMetrics = promptHotnessMetrics.get(getPromptSortKey(b));
            const scoreDifference = Number(bMetrics?.hot_score || 0) - Number(aMetrics?.hot_score || 0);
            if (scoreDifference !== 0) return scoreDifference;
            return comparePromptStableIds(a, b);
        });
    }

    return sortedItems.sort((a, b) => {
        const orderDifference = getPromptRandomOrderKey(a) - getPromptRandomOrderKey(b);
        return orderDifference || comparePromptStableIds(a, b);
    });
}

function applyPromptGalleryFiltersAndSort(items = promptGalleryBaseFilteredItems) {
    return applyPromptSort(applyPromptMediaFilter(items));
}

function normalizePromptHotnessMetric(row = {}) {
    const promptId = String(row.prompt_id ?? row.promptId ?? '').trim();
    if (!promptId) return null;
    return {
        prompt_id: promptId,
        favorite_count: Math.max(0, Number(row.favorite_count ?? row.favoriteCount) || 0),
        comment_count: Math.max(0, Number(row.comment_count ?? row.commentCount) || 0),
        click_count: Math.max(0, Number(row.click_count ?? row.clickCount) || 0),
        hot_score: Math.max(0, Number(row.hot_score ?? row.hotScore) || 0)
    };
}

async function loadPromptHotnessMetrics(options = {}) {
    if (promptHotnessMetrics.size > 0 && options.forceRefresh !== true) return promptHotnessMetrics;
    if (promptHotnessLoadPromise) return promptHotnessLoadPromise;
    if (!window.supabaseClient?.rpc) return promptHotnessMetrics;

    promptHotnessLoadPromise = (async () => {
        const { data, error } = await window.supabaseClient.rpc('fn_public_prompt_hotness', {
            p_site: window.SiteConfig?.site === 'intl' ? 'intl' : 'cn'
        });
        if (error) throw error;
        promptHotnessMetrics.clear();
        (Array.isArray(data) ? data : []).forEach((row) => {
            const metric = normalizePromptHotnessMetric(row);
            if (metric) promptHotnessMetrics.set(metric.prompt_id, metric);
        });
        return promptHotnessMetrics;
    })().catch((error) => {
        console.warn('[PromptSort] Failed to load hotness metrics:', error?.message || error);
        return promptHotnessMetrics;
    }).finally(() => {
        promptHotnessLoadPromise = null;
    });

    return promptHotnessLoadPromise;
}

function syncPromptSortButtons(options = {}) {
    document.querySelectorAll('.prompt-sort-filter__button[data-prompt-sort]').forEach((button) => {
        const active = button.dataset.promptSort === currentPromptSort;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.disabled = options.loading === true && button.dataset.promptSort === 'hot';
    });
}

async function setPromptSort(sortType = 'random') {
    const normalizedSort = sortType === 'hot' ? 'hot' : 'random';
    if (normalizedSort === currentPromptSort && promptGalleryHasRendered) return;

    currentPromptSort = normalizedSort;
    syncPromptSortButtons({ loading: normalizedSort === 'hot' && promptHotnessMetrics.size === 0 });
    if (normalizedSort === 'hot') {
        await loadPromptHotnessMetrics();
        if (currentPromptSort !== normalizedSort) return;
        if (promptHotnessMetrics.size === 0) {
            currentPromptSort = 'random';
        }
    }
    syncPromptSortButtons();
    allFilteredItems = applyPromptGalleryFiltersAndSort();
    renderCurrentPage({ preserveScroll: true });
}

function syncPromptMediaFilterButtons() {
    document.querySelectorAll('.prompt-media-filter__button[data-media-filter]').forEach((button) => {
        const active = button.dataset.mediaFilter === currentPromptMediaFilter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function setPromptMediaFilter(mediaFilter = 'image') {
    const normalizedFilter = ['image', 'video'].includes(mediaFilter) ? mediaFilter : 'image';
    if (normalizedFilter === currentPromptMediaFilter && promptGalleryHasRendered) return;

    currentPromptMediaFilter = normalizedFilter;
    syncPromptMediaFilterButtons();
    allFilteredItems = applyPromptGalleryFiltersAndSort();
    renderCurrentPage({ preserveScroll: true });
}

function setupPromptMediaFilters() {
    const filter = document.querySelector('.prompt-media-filter');
    if (filter && filter.dataset.bound !== 'true') {
        filter.dataset.bound = 'true';
        filter.addEventListener('click', (event) => {
            const button = event.target.closest('.prompt-media-filter__button[data-media-filter]');
            if (!button || !filter.contains(button)) return;
            setPromptMediaFilter(button.dataset.mediaFilter);
        });
    }
    syncPromptMediaFilterButtons();

    const sortFilter = document.querySelector('.prompt-sort-filter');
    if (sortFilter && sortFilter.dataset.bound !== 'true') {
        sortFilter.dataset.bound = 'true';
        const warmHotness = () => {
            void loadPromptHotnessMetrics();
        };
        sortFilter.addEventListener('pointerenter', warmHotness, { once: true, passive: true });
        sortFilter.addEventListener('focusin', warmHotness, { once: true });
        sortFilter.addEventListener('touchstart', warmHotness, { once: true, passive: true });
        sortFilter.addEventListener('click', (event) => {
            const button = event.target.closest('.prompt-sort-filter__button[data-prompt-sort]');
            if (!button || !sortFilter.contains(button)) return;
            void setPromptSort(button.dataset.promptSort);
        });
    }
    syncPromptSortButtons();
}

function renderGallery(filter, reset = true) {
    const grid = document.querySelector('.gallery-container');
    if (!grid) return;

    currentFilter = filter;

    if (reset) {
        if (filter === 'favorites') {
            promptGalleryBaseFilteredItems = isPromptFavoriteUserAuthenticated()
                ? PROMPTS.filter((prompt) => isPromptFavoriteSaved(getPromptFavoriteIdForItem(prompt)))
                : [];
        } else if (filter === 'all') {
            promptGalleryBaseFilteredItems = [...PROMPTS];
        } else {
            // Filter by category tag OR AI tags (for sub-tag filtering)
            const filterLower = filter.toLowerCase();
            promptGalleryBaseFilteredItems = PROMPTS.filter(p => {
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

    allFilteredItems = applyPromptGalleryFiltersAndSort();

    renderCurrentPage();
    promptGalleryHasRendered = true;
    document.documentElement.classList.remove('prompts-gallery-pending');
}

function getPromptGalleryBatchSize() {
    return Math.max(1, Number.parseInt(CARDS_PER_PAGE, 10) || 20);
}

function getPromptGalleryInitialRenderCount() {
    return Math.min(getPromptGalleryBatchSize(), PROMPT_GALLERY_INITIAL_RENDER_MAX_COUNT);
}

function prefersReducedPromptGalleryMotion() {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function disconnectPromptGalleryCardMotionObserver() {
    promptGalleryCardMotionObserver?.disconnect();
    promptGalleryCardMotionObserver = null;
    document.querySelectorAll('.gallery-container .prompt-card--in-viewport, .gallery-container .prompt-card.breathing')
        .forEach((card) => card.classList.remove('prompt-card--in-viewport', 'breathing'));
}

function getPromptGalleryCardMotionObserver() {
    if (promptGalleryCardMotionObserver || typeof IntersectionObserver === 'undefined') {
        return promptGalleryCardMotionObserver;
    }

    promptGalleryCardMotionObserver = new IntersectionObserver((entries) => {
        const reduceMotion = prefersReducedPromptGalleryMotion();
        entries.forEach((entry) => {
            const isNearViewport = entry.isIntersecting;
            entry.target.classList.toggle('prompt-card--in-viewport', isNearViewport);
            entry.target.classList.toggle('breathing', isNearViewport && !reduceMotion);
        });
    }, {
        threshold: 0.01,
        rootMargin: '120px 0px'
    });

    return promptGalleryCardMotionObserver;
}

function activatePromptGalleryCardMotion(card) {
    if (!card) return;
    const observer = getPromptGalleryCardMotionObserver();
    if (observer) {
        observer.observe(card);
        return;
    }

    card.classList.add('prompt-card--in-viewport');
    if (!prefersReducedPromptGalleryMotion()) {
        card.classList.add('breathing');
    }
}

function resetPromptGalleryInfiniteState() {
    if (promptGalleryScrollIdleTimerId) {
        window.clearTimeout(promptGalleryScrollIdleTimerId);
        promptGalleryScrollIdleTimerId = null;
    }
    if (promptGalleryRenderChunkFrameId) {
        window.cancelAnimationFrame(promptGalleryRenderChunkFrameId);
        promptGalleryRenderChunkFrameId = null;
    }
    if (promptGalleryMasonryHeightSyncFrameId) {
        window.cancelAnimationFrame(promptGalleryMasonryHeightSyncFrameId);
        promptGalleryMasonryHeightSyncFrameId = null;
    }
    document.documentElement.classList.remove('prompt-gallery-scrolling');
    promptGalleryQueuedRenderTarget = 0;
    promptGallerySentinelFillRequested = false;
    disconnectPromptGalleryCardImageObserver();
    disconnectPromptGalleryCardMotionObserver();
    promptGalleryRenderedCount = 0;
    promptGalleryMasonryState = null;
    allCardsRendered = false;
    isLoading = false;
    renderedCards = new Map();
    removePromptGalleryPaginationControls();
}

function removePromptGalleryPaginationControls() {
    document.querySelectorAll('.prompts-pagination-nav').forEach((nav) => nav.remove());
}

function createPromptGalleryCard(item, itemIndex = 0, batchIndex = 0) {
    const videoAssets = getPromptVideoAssets(item);
    const videoPosterAsset = videoAssets[0]?.posterAsset || normalizePromptImageAsset(videoAssets[0]?.poster);
    const sourceImageAssets = getPromptImageAssets(item);
    const videoPosterKey = getPromptImageCanonicalDedupeKey(getPromptImageAssetOriginalUrl(videoPosterAsset));
    const imageAssets = videoPosterAsset
        ? [
            videoPosterAsset,
            ...sourceImageAssets.filter((asset) => (
                getPromptImageCanonicalDedupeKey(getPromptImageAssetOriginalUrl(asset)) !== videoPosterKey
            ))
        ]
        : sourceImageAssets;
    const primaryImageAsset = imageAssets[0] || null;
    const shouldLoadImageEagerly = itemIndex < PROMPT_GALLERY_EAGER_IMAGE_COUNT;
    const promptOpenId = getPromptStableOpenId(item);
    const card = document.createElement('div');
    card.className = 'prompt-card card-enter prompt-card--loading';
    card.classList.toggle('prompt-card--video', videoAssets.length > 0);
    card.dataset.tags = Array.isArray(item.tags) ? item.tags.join(',') : '';
    card.dataset.id = item.id;
    card.dataset.promptId = promptOpenId;
    card.dataset.galleryIndex = String(itemIndex);
    card.dataset.images = JSON.stringify(imageAssets);
    bindPromptCardActivation(card, promptOpenId);
    setPromptCardStaggerClass(card, batchIndex);

    const hasMultiple = imageAssets.length > 1;
    const indicators = hasMultiple
        ? `<div class="card-indicators">${imageAssets.map((_, i) => `<span class="indicator-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
        : '';

    const promptFavoriteId = getPromptFavoriteIdForItem(item);
    const promptSourceActionsMarkup = `
        ${buildPromptSourceLinkMarkup(item)}
        ${buildPromptFavoriteClusterMarkup(item, { favoriteId: promptFavoriteId })}
    `;

    const breatheDelay = (Math.random() * 4).toFixed(2);
    setPromptsCssVars(card, {
        '--breathe-delay': `${breatheDelay}s`
    });
    applyPromptCardImageAssetAspectRatio(card, primaryImageAsset);

    card.innerHTML = `
        ${buildPromptCardSkeletonMarkup(itemIndex)}
        <img class="card-image" loading="${shouldLoadImageEagerly ? 'eager' : 'lazy'}" decoding="async" alt="${getLocalizedField(item, 'title')}" draggable="false">
        ${videoAssets.length ? '<span class="prompt-card-video-badge" aria-label="视频"><i class="fas fa-play" aria-hidden="true"></i></span>' : ''}
        <div class="card-overlay">
            ${indicators}
            <div class="card-overlay-bottom">
                ${buildPromptSourceAttributionMarkup(item)}
                <div class="card-source-actions">
                    ${promptSourceActionsMarkup}
                </div>
            </div>
        </div>
    `;

    bindPromptSourceActionEvents(card, promptFavoriteId);

    const cardImage = card.querySelector('.card-image');
    if (cardImage) {
        disablePromptImageDrag(cardImage);
        cardImage.loading = shouldLoadImageEagerly ? 'eager' : 'lazy';
        cardImage.decoding = 'async';
        cardImage.setAttribute('fetchpriority', shouldLoadImageEagerly ? 'high' : 'auto');
        if ('fetchPriority' in cardImage) {
            cardImage.fetchPriority = shouldLoadImageEagerly ? 'high' : 'auto';
        }
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
    if (shouldLoadImageEagerly) {
        setPromptCardImageSource(cardImage, primaryImageAsset);
    } else {
        observePromptGalleryCardImage(cardImage, primaryImageAsset);
    }
    if (cardImage?.complete && cardImage.naturalWidth > 0) {
        markPromptCardImageReady(card, cardImage);
    }

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

    renderedCards.set(promptOpenId || String(itemIndex), card);
    return card;
}

function renderPromptGalleryRange(startIndex = 0, endIndex = 0, options = {}) {
    const grid = document.querySelector('.gallery-container');
    if (!grid || isLoading) return 0;

    const safeStart = Math.max(0, Math.min(Number.parseInt(startIndex, 10) || 0, allFilteredItems.length));
    const safeEnd = Math.max(safeStart, Math.min(Number.parseInt(endIndex, 10) || 0, allFilteredItems.length));
    const itemsToLoad = allFilteredItems.slice(safeStart, safeEnd);
    if (!itemsToLoad.length) {
        allCardsRendered = promptGalleryRenderedCount >= allFilteredItems.length;
        return 0;
    }

    isLoading = true;
    if (safeStart > 0) {
        syncPromptGalleryMasonryColumnHeights(promptGalleryMasonryState);
    }
    if (options.warmImages !== false) {
        warmPromptGalleryLeadImages(itemsToLoad);
    }

    itemsToLoad.forEach((item, offset) => {
        const itemIndex = safeStart + offset;
        const batchIndex = offset;
        const card = createPromptGalleryCard(item, itemIndex, batchIndex);
        appendPromptGalleryCard(grid, card, itemIndex, promptGalleryMasonryState);

        const staggerDelay = options.skipEntranceDelay ? 0 : batchIndex * 50;
        setTimeout(() => {
            showPromptCard(card, batchIndex);
            setTimeout(() => {
                if (!card.isConnected) return;
                activatePromptGalleryCardMotion(card);
            }, 850);
        }, staggerDelay);
    });

    promptGalleryRenderedCount = Math.max(promptGalleryRenderedCount, safeEnd);
    allCardsRendered = promptGalleryRenderedCount >= allFilteredItems.length;
    isLoading = false;
    return itemsToLoad.length;
}

function renderCurrentPage(options = {}) {
    const grid = document.querySelector('.gallery-container');
    if (!grid) return;

    const preserveScroll = options.preserveScroll === true;
    const preservedScrollY = preserveScroll ? window.scrollY : 0;
    const previousRenderedCount = promptGalleryRenderedCount;
    resetPromptGalleryInfiniteState();
    promptGalleryMasonryState = preparePromptGalleryContainer(grid);

    if (!preserveScroll) {
        window.scrollTo({ top: 0, behavior: shouldForcePromptPageTop() ? 'auto' : 'smooth' });
    }

    const totalItems = allFilteredItems.length;
    const requestedCount = Number.parseInt(options.minCount, 10) || 0;
    const targetCount = Math.min(
        totalItems,
        Math.max(getPromptGalleryInitialRenderCount(), requestedCount, preserveScroll ? previousRenderedCount : 0)
    );

    renderPromptGalleryRange(0, targetCount, { skipEntranceDelay: preserveScroll });

    requestAnimationFrame(() => {
        grid.classList.add('visible');
        if (preserveScroll) {
            window.scrollTo({ top: preservedScrollY, behavior: 'auto' });
        } else {
            forcePromptPageTop();
        }
        preloadPromptGalleryAroundVisibleRange('down');
    });
}

function ensurePromptGalleryRenderedThrough(targetIndex = 0, options = {}) {
    const safeTargetIndex = Math.max(0, Number.parseInt(targetIndex, 10) || 0);
    if (!allFilteredItems.length || safeTargetIndex < promptGalleryRenderedCount) {
        return 0;
    }

    if (!promptGalleryMasonryState) {
        renderCurrentPage({
            preserveScroll: true,
            minCount: safeTargetIndex + 1
        });
        return 0;
    }

    const nextCount = Math.min(allFilteredItems.length, safeTargetIndex + 1);
    return renderPromptGalleryRange(promptGalleryRenderedCount, nextCount, options);
}

function getPromptGalleryVisibleRange() {
    const cards = Array.from(document.querySelectorAll('.gallery-container .prompt-card[data-gallery-index]'));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    let minIndex = Infinity;
    let maxIndex = -Infinity;

    cards.forEach((card) => {
        const index = Number.parseInt(card.dataset.galleryIndex, 10);
        if (!Number.isFinite(index)) return;

        const rect = card.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > viewportHeight) return;

        minIndex = Math.min(minIndex, index);
        maxIndex = Math.max(maxIndex, index);
    });

    if (!Number.isFinite(minIndex) || !Number.isFinite(maxIndex)) {
        return null;
    }

    return { minIndex, maxIndex };
}

function preloadPromptGalleryItems(startIndex = 0, endIndex = 0) {
    const safeStart = Math.max(0, Math.min(Number.parseInt(startIndex, 10) || 0, allFilteredItems.length));
    const safeEnd = Math.max(safeStart, Math.min(Number.parseInt(endIndex, 10) || 0, allFilteredItems.length));
    if (safeEnd <= safeStart) return 0;

    warmPromptGalleryLeadImages(allFilteredItems.slice(safeStart, safeEnd));
    return safeEnd - safeStart;
}

function getPromptGalleryViewportHeight() {
    return Math.max(
        window.innerHeight || 0,
        document.documentElement?.clientHeight || 0,
        window.visualViewport?.height || 0
    );
}

function getPromptGalleryDocumentBottomDistance() {
    const doc = document.documentElement;
    const body = document.body;
    const scrollY = Math.max(
        0,
        Math.round(window.scrollY || window.pageYOffset || doc?.scrollTop || body?.scrollTop || 0)
    );
    const viewportHeight = getPromptGalleryViewportHeight();
    const documentHeight = Math.max(
        doc?.scrollHeight || 0,
        body?.scrollHeight || 0,
        doc?.offsetHeight || 0,
        body?.offsetHeight || 0,
        doc?.clientHeight || 0
    );
    return Math.max(0, documentHeight - (scrollY + viewportHeight));
}

function isPromptGalleryNearDocumentBottom() {
    const viewportHeight = getPromptGalleryViewportHeight();
    const threshold = Math.max(PROMPT_GALLERY_BOTTOM_LOAD_MARGIN_PX, Math.round(viewportHeight * 0.75));
    return getPromptGalleryDocumentBottomDistance() <= threshold;
}

function isPromptGalleryLoadSentinelNearViewport() {
    const sentinel = document.getElementById('promptGalleryLoadSentinel');
    if (!sentinel) return false;

    const rect = sentinel.getBoundingClientRect();
    const viewportHeight = getPromptGalleryViewportHeight();
    return rect.top <= viewportHeight + PROMPT_GALLERY_SENTINEL_PREFETCH_MARGIN_PX;
}

function getPromptGalleryProgressiveBatchSize() {
    if (isPromptGalleryMobileMasonryLayout()) {
        return PROMPT_GALLERY_SCROLL_PRELOAD_COUNT;
    }

    const columnCount = promptGalleryMasonryState?.columnCount
        || getPromptGalleryMasonryColumnCount(document.querySelector('.gallery-container'));
    return Math.max(
        PROMPT_GALLERY_SCROLL_PRELOAD_COUNT,
        columnCount * PROMPT_GALLERY_DESKTOP_PREFETCH_ROWS
    );
}

function queuePromptGalleryRenderThrough(targetIndex = 0, options = {}) {
    if (allCardsRendered || !promptGalleryMasonryState) return 0;

    const targetCount = Math.min(
        allFilteredItems.length,
        Math.max(promptGalleryRenderedCount, (Number.parseInt(targetIndex, 10) || 0) + 1)
    );
    promptGalleryQueuedRenderTarget = Math.max(promptGalleryQueuedRenderTarget, targetCount);
    if (options.continueWhileSentinelNear === true) {
        promptGallerySentinelFillRequested = true;
    }
    if (promptGalleryRenderChunkFrameId || targetCount <= promptGalleryRenderedCount) return 0;

    const renderChunk = () => {
        promptGalleryRenderChunkFrameId = null;
        if (allCardsRendered || !promptGalleryMasonryState) {
            promptGalleryQueuedRenderTarget = promptGalleryRenderedCount;
            promptGallerySentinelFillRequested = false;
            return;
        }

        if (
            document.documentElement.classList.contains('prompt-gallery-scrolling')
            && !promptGallerySentinelFillRequested
        ) {
            return;
        }

        const nextEnd = Math.min(
            promptGalleryQueuedRenderTarget,
            promptGalleryRenderedCount + PROMPT_GALLERY_RENDER_CHUNK_SIZE
        );
        renderPromptGalleryRange(promptGalleryRenderedCount, nextEnd, {
            skipEntranceDelay: true,
            warmImages: false
        });

        if (promptGalleryRenderedCount < promptGalleryQueuedRenderTarget) {
            promptGalleryRenderChunkFrameId = requestAnimationFrame(renderChunk);
            return;
        }

        const shouldContinueSentinelFill = promptGallerySentinelFillRequested;
        promptGallerySentinelFillRequested = false;
        if (
            shouldContinueSentinelFill
            && !allCardsRendered
            && isPromptGalleryLoadSentinelNearViewport()
        ) {
            queuePromptGalleryNextScrollBatch({ continueWhileSentinelNear: true });
        }
    };

    promptGalleryRenderChunkFrameId = requestAnimationFrame(renderChunk);
    return targetCount - promptGalleryRenderedCount;
}

function queuePromptGalleryNextScrollBatch(options = {}) {
    return queuePromptGalleryRenderThrough(
        promptGalleryRenderedCount + getPromptGalleryProgressiveBatchSize() - 1,
        options
    );
}

function setupPromptGalleryLoadSentinel() {
    if (promptGalleryLoadSentinelObserver || typeof IntersectionObserver === 'undefined') return;

    const sentinel = document.getElementById('promptGalleryLoadSentinel');
    if (!sentinel) return;

    promptGalleryLoadSentinelObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            queuePromptGalleryNextScrollBatch({ continueWhileSentinelNear: true });
        }
    }, {
        root: null,
        rootMargin: `0px 0px ${PROMPT_GALLERY_SENTINEL_PREFETCH_MARGIN_PX}px 0px`,
        threshold: 0
    });
    promptGalleryLoadSentinelObserver.observe(sentinel);
}

function preloadPromptGalleryAroundVisibleRange(direction = promptGalleryLastScrollDirection) {
    if (!allFilteredItems.length) return 0;
    const preloadCount = getPromptGalleryProgressiveBatchSize();

    if (direction !== 'up' && isPromptGalleryNearDocumentBottom()) {
        return queuePromptGalleryNextScrollBatch();
    }

    const visibleRange = getPromptGalleryVisibleRange();
    if (!visibleRange) {
        return direction === 'up'
            ? preloadPromptGalleryItems(0, preloadCount)
            : queuePromptGalleryNextScrollBatch();
    }

    if (direction === 'up') {
        const startIndex = Math.max(0, visibleRange.minIndex - preloadCount);
        return preloadPromptGalleryItems(startIndex, visibleRange.minIndex);
    }

    const preloadStart = visibleRange.maxIndex + 1;
    const preloadEnd = Math.min(allFilteredItems.length, preloadStart + preloadCount);
    preloadPromptGalleryItems(preloadStart, preloadEnd);
    return queuePromptGalleryRenderThrough(preloadEnd - 1);
}

function schedulePromptGalleryScrollIdlePreload(delayMs = PROMPT_GALLERY_SCROLL_IDLE_MS) {
    if (promptGalleryScrollIdleTimerId) {
        window.clearTimeout(promptGalleryScrollIdleTimerId);
    }

    promptGalleryScrollIdleTimerId = window.setTimeout(() => {
        promptGalleryScrollIdleTimerId = null;
        document.documentElement.classList.remove('prompt-gallery-scrolling');
        queuePromptGalleryPendingImageActivations();
        if (promptGalleryQueuedRenderTarget > promptGalleryRenderedCount) {
            queuePromptGalleryRenderThrough(promptGalleryQueuedRenderTarget - 1);
        }
        preloadPromptGalleryAroundVisibleRange(promptGalleryLastScrollDirection);
    }, Math.max(PROMPT_GALLERY_SCROLL_IDLE_MS, Number.parseInt(delayMs, 10) || PROMPT_GALLERY_SCROLL_IDLE_MS));
}

function schedulePromptGalleryResizeIdlePreload() {
    setPromptGalleryResizeLightMode();
    schedulePromptGalleryScrollIdlePreload(PROMPT_GALLERY_RESIZE_PRELOAD_IDLE_MS);
}

function handlePromptGalleryScroll() {
    const nextScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
    const deltaY = nextScrollY - promptGalleryLastScrollY;
    if (Math.abs(deltaY) > 1) {
        promptGalleryLastScrollDirection = deltaY > 0 ? 'down' : 'up';
        promptGalleryLastScrollY = nextScrollY;
        document.documentElement.classList.add('prompt-gallery-scrolling');
    }
    schedulePromptGalleryScrollIdlePreload();
}

function handlePromptGalleryTouchStart(event) {
    const touch = event.touches?.[0];
    if (!touch) return;
    promptGalleryTouchLastY = touch.clientY;
}

function handlePromptGalleryTouchMove(event) {
    const touch = event.touches?.[0];
    if (!touch) return;

    const deltaY = promptGalleryTouchLastY - touch.clientY;
    promptGalleryTouchLastY = touch.clientY;

    if (deltaY > 1) {
        promptGalleryLastScrollDirection = 'down';
    } else if (deltaY < -1) {
        promptGalleryLastScrollDirection = 'up';
    }

    schedulePromptGalleryScrollIdlePreload();
}

function loadMoreCards() {
    return ensurePromptGalleryRenderedThrough(promptGalleryRenderedCount + getPromptGalleryBatchSize() - 1);
}

// --- Infinite Scroll ---
function setupInfiniteScroll() {
    if (promptGalleryInfiniteScrollBound) return;
    promptGalleryInfiniteScrollBound = true;
    promptGalleryLastScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
    window.addEventListener('scroll', handlePromptGalleryScroll, { passive: true });
    window.addEventListener('resize', schedulePromptGalleryResizeIdlePreload, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedulePromptGalleryScrollIdlePreload, { passive: true });
    window.visualViewport?.addEventListener('resize', schedulePromptGalleryResizeIdlePreload, { passive: true });
    document.addEventListener('touchstart', handlePromptGalleryTouchStart, { passive: true });
    document.addEventListener('touchmove', handlePromptGalleryTouchMove, { passive: true });
    document.addEventListener('touchend', schedulePromptGalleryScrollIdlePreload, { passive: true });
    setupPromptGalleryLoadSentinel();
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
        .sort((a, b) => b.count - a.count || a.en.localeCompare(b.en, 'en', { sensitivity: 'base' }))
        .slice(0, PROMPT_HOT_TAG_LIMIT);

    return sortedTags; // Returns array of { en, zh, count }
}

function getAISubTagChineseLabel(tagObj = {}) {
    const englishLabel = normalizePromptTagText(tagObj.en);
    const pairedChineseLabel = normalizePromptTagText(tagObj.zh);
    if (pairedChineseLabel) return pairedChineseLabel;
    if (containsPromptCjkText(englishLabel)) return englishLabel;
    return TAG_TRANSLATIONS[englishLabel] || TAG_TRANSLATIONS[englishLabel.toLowerCase()] || '';
}

// Show AI sub-tags in navigation
function showAISubTags(category, navContainer) {
    const subTags = getAISubTags(category);
    const isEnglish = getCurrentLanguage() === 'en';
    const visibleSubTags = subTags
        .map((tagObj) => ({
            ...tagObj,
            cn: getAISubTagChineseLabel(tagObj)
        }))
        .filter((tagObj) => isEnglish || tagObj.cn);
    if (visibleSubTags.length === 0) return;

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

        visibleSubTags.forEach((tagObj, i) => {
            subNavHTML += `
                <div class="nav-item sub-tag ${buildPromptsStaggerClass(i)}" data-filter="${tagObj.en.toLowerCase()}">
                    <span class="en">${tagObj.en}</span>
                    ${tagObj.cn ? `<span class="cn">${tagObj.cn}</span>` : ''}
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

        renderGallery('all');

        finishPromptsNavTransition(navContainer, 'prompts-nav-hidden-up');
    }, 250);
}

// --- Prompt Search ---
function setupSearch() {
    const searchInput = document.getElementById('gallerySearch');
    if (!searchInput) return;

    let debounceTimer;

    // Input event
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        // Debounce for performance
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            filterBySearch(query.toLowerCase());
        }, 200);
    });

    // Clear search on ESC
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            filterBySearch('');
            searchInput.blur();
        }
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

    await warmPromptSearchIndex();
    if (!isPromptSearchRequestCurrent(searchRequestId, normalizedQuery)) {
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
    allFilteredItems = PROMPTS.filter((item, index) => {
        if (!item) return;

        let isVisible = matchedKeys.has(item.id) || matchedKeys.has(String(item.id)) || matchedKeys.has(index) || matchedKeys.has(String(index));

        if (searchingForColor && !isVisible) {
            isVisible = item.dominantColors && item.dominantColors.includes(searchingForColor);
        }

        return isVisible;
    });
    promptGalleryBaseFilteredItems = allFilteredItems;
    allFilteredItems = applyPromptGalleryFiltersAndSort(promptGalleryBaseFilteredItems);

    renderCurrentPage();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
}

// --- Modal Logic ---
let currentModalImageIndex = 0;
let currentModalImages = [];
let currentModalImageThumbs = [];
let currentModalImagePalettes = [];
let currentModalVideoAsset = null;
let currentModalThumbRenderKey = '';
let currentModalThumbWarmupIdleId = null;
let currentModalThumbWarmupTimerId = null;
let isCommentMode = false;
let isRelatedMode = false;
let promptCommentModeReturnTimer = null;
let promptRelatedRenderFrameId = null;
let promptRelatedRenderTimerId = null;
let promptRelatedWarmupIdleId = null;
let promptRelatedWarmupTimerId = null;
let promptRelatedRenderToken = 0;
let promptModalLayoutWasMobile = null;
let promptModalLayoutSyncFrameId = null;
let promptAreaMotionFrameId = null;
let promptAreaMotionTimerId = null;
let currentPromptId = null;
let currentPromptMediaItemKey = '';
let currentPromptMediaType = '';
let currentPromptMediaVariants = [];
const PROMPT_MOBILE_SIDE_MODE_RETURN_CLEANUP_MS = 620;
const PROMPT_DESKTOP_SIDE_MODE_RETURN_CLEANUP_MS = 520;
const PROMPT_DESKTOP_RELATED_SELECTION_MOTION_MS = 500;
const PROMPT_DESKTOP_RELATED_SELECTION_OFFSET_PX = 24;
const PROMPT_DESKTOP_SIDE_MODE_PROMPT_OFFSET_PX = 24;
const PROMPT_DESKTOP_SIDE_MODE_PROMPT_MOTION_MS = 500;

function clearPromptCommentModeReturnState(modalInner = document.querySelector('#promptModal .modal-inner')) {
    if (promptCommentModeReturnTimer) {
        clearTimeout(promptCommentModeReturnTimer);
        promptCommentModeReturnTimer = null;
    }
    modalInner?.classList.remove('comment-mode-returning', 'comment-mode-title-revealing');
}

function isPromptDetailSideModeActive() {
    return isCommentMode || isRelatedMode;
}
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
    if (!isPromptModalMobileLayout() || !isPromptDetailSideModeActive()) return;
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

function isPromptCommentInputDockOpen() {
    return Boolean(promptCommentInputDock?.isActive());
}

function isPromptModalExpandedCommentView() {
    const modal = document.getElementById('promptModal');
    return !!(modal?.classList.contains('active') && isCommentMode && isPromptModalMobileLayout());
}

function isPromptModalExpandedRelatedView() {
    const modal = document.getElementById('promptModal');
    return !!(modal?.classList.contains('active') && isRelatedMode && isPromptModalMobileLayout());
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

    const useBackState = isPromptDetailSideModeActive() || isPromptCommentInputDockOpen();
    button.classList.toggle('is-back', useBackState);
    button.classList.toggle('is-close', !useBackState);
    button.setAttribute('aria-label', useBackState ? 'Back' : 'Close');
    icon.className = useBackState ? 'fas fa-arrow-left' : 'fas fa-times';
}

function handlePromptModalTopButton() {
    if (isPromptCommentInputDockOpen()) {
        closePromptCommentInputDock();
        return;
    }

    if (isCommentMode) {
        toggleCommentMode();
        return;
    }

    if (isRelatedMode) {
        toggleRelatedMode();
        return;
    }

    closePromptModal();
}

function handlePromptModalEscapeKey(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;

    const modal = document.getElementById('promptModal');
    if (!modal?.classList.contains('active')) return;

    const eventTarget = event.target instanceof Element ? event.target : null;
    const foregroundDialog = eventTarget?.closest(
        'dialog[open], [role="dialog"][aria-modal="true"], .modal-overlay.active, .auth-sheet-overlay.active, .auth-sheet-overlay.visible'
    );
    if (foregroundDialog && foregroundDialog !== modal && !modal.contains(foregroundDialog)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
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
    document.getElementById('relatedTriggerBtn')?.addEventListener('click', () => {
        toggleRelatedMode();
    });
    document.addEventListener('keydown', handlePromptModalEscapeKey, true);
    syncPromptRelatedTriggerLabel();

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
    return !!(modal && modalInner && modal.classList.contains('active') && isPromptDetailSideModeActive());
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

function disablePromptModalKeyboardDockForCommentInput() {
    const viewport = window.visualViewport;
    if (viewport && promptModalKeyboardDock.onViewportChange) {
        viewport.removeEventListener('resize', requestPromptModalViewportSync);
        viewport.removeEventListener('scroll', requestPromptModalViewportSync);
        window.removeEventListener('resize', requestPromptModalViewportSync);
        window.removeEventListener('orientationchange', requestPromptModalViewportSync);
    }
    if (promptModalKeyboardDock.viewportRafId) {
        cancelAnimationFrame(promptModalKeyboardDock.viewportRafId);
        promptModalKeyboardDock.viewportRafId = null;
    }
    promptModalKeyboardDock.onViewportChange = null;
    promptModalKeyboardDock.attached = false;
    clearPromptModalKeyboardSettleTimer();
    clearPromptModalDockTimers();
    resetPromptModalKeyboardDockIfNeeded(false);
}

function preparePromptCommentModeInputDock() {
    if (!isPromptModalIOSMobile()) return;
    const { modal, modalInner } = getPromptModalDockNodes();
    if (!modal?.classList.contains('active') || !modalInner?.classList.contains('comment-mode')) return;

    disablePromptModalKeyboardDockForCommentInput();
    lockPromptModalCommentModeGeometry({ force: true });
    if (window.iOSScrollLock?.isLocked) {
        window.iOSScrollLock.lockLight(modalInner, { restoreScrollDuringViewport: false });
    }
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

function getPromptMediaTabLabel(type = '') {
    if (type === 'video') {
        return window.i18n?.t('gallery.videoPrompt') || (getCurrentLanguage() === 'en' ? 'Video prompt' : '视频提示词');
    }
    return window.i18n?.t('gallery.imagePrompt') || (getCurrentLanguage() === 'en' ? 'Image prompt' : '图片提示词');
}

function getPromptDefaultLabel() {
    return window.i18n?.t('gallery.prompt') || (getCurrentLanguage() === 'en' ? 'Prompt' : '提示词');
}

function resetPromptMediaTabs({ resetItem = false } = {}) {
    const tabs = document.getElementById('promptMediaTabs');
    const defaultLabel = document.getElementById('promptDefaultLabel');
    if (tabs) {
        tabs.hidden = true;
        tabs.removeAttribute('data-active-type');
        tabs.querySelectorAll('[data-prompt-media-type]').forEach((button) => {
            button.hidden = false;
            button.setAttribute('aria-selected', 'false');
            button.tabIndex = -1;
        });
    }
    if (defaultLabel) {
        defaultLabel.hidden = false;
        defaultLabel.textContent = getPromptDefaultLabel();
    }
    currentPromptMediaVariants = [];
    currentPromptMediaType = '';
    if (resetItem) currentPromptMediaItemKey = '';
}

function syncPromptMediaTabSelection({ focus = false } = {}) {
    const tabs = document.getElementById('promptMediaTabs');
    if (!tabs) return;
    tabs.dataset.activeType = currentPromptMediaType;
    tabs.querySelectorAll('[data-prompt-media-type]').forEach((button) => {
        const selected = button.dataset.promptMediaType === currentPromptMediaType;
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
    });
}

function selectPromptMediaType(type = '', { focus = false } = {}) {
    const variant = currentPromptMediaVariants.find((entry) => entry.type === type);
    const promptText = document.getElementById('modalPromptText');
    if (!variant || !promptText) return false;
    currentPromptMediaType = type;
    setPromptDetailTextState(promptText, variant.text);
    syncPromptMediaTabSelection({ focus });
    return true;
}

function handlePromptMediaTabKeydown(event, type = '') {
    const availableTypes = currentPromptMediaVariants.map((variant) => variant.type);
    if (!availableTypes.length) return;
    const currentIndex = Math.max(0, availableTypes.indexOf(type));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % availableTypes.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + availableTypes.length) % availableTypes.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = availableTypes.length - 1;
    else return;
    event.preventDefault();
    selectPromptMediaType(availableTypes[nextIndex], { focus: true });
}

function renderPromptMediaTabs(promptText, item = {}) {
    const mediaTabsApi = window.FatherKeyPromptMediaTabs;
    const localizedText = getPromptModalPromptText(item);
    const fallbackText = String(item.prompt_text || item.prompt || '').trim();
    const mediaState = mediaTabsApi?.buildPromptMediaVariants?.(localizedText, fallbackText) || {
        fullText: localizedText || fallbackText,
        variants: []
    };
    const itemKey = getPromptStableOpenId(item);
    if (currentPromptMediaItemKey !== itemKey) {
        currentPromptMediaItemKey = itemKey;
        currentPromptMediaType = '';
    }
    currentPromptMediaVariants = Array.isArray(mediaState.variants) ? mediaState.variants : [];
    if (!currentPromptMediaVariants.length) {
        resetPromptMediaTabs();
        currentPromptMediaItemKey = itemKey;
        setPromptDetailTextState(promptText, mediaState.fullText);
        return;
    }

    const tabs = document.getElementById('promptMediaTabs');
    const defaultLabel = document.getElementById('promptDefaultLabel');
    if (currentPromptMediaVariants.length === 1) {
        const onlyVariant = currentPromptMediaVariants[0];
        if (tabs) tabs.hidden = true;
        if (defaultLabel) {
            defaultLabel.hidden = false;
            defaultLabel.textContent = getPromptMediaTabLabel(onlyVariant.type);
        }
        currentPromptMediaType = onlyVariant.type;
        setPromptDetailTextState(promptText, onlyVariant.text);
        return;
    }
    if (defaultLabel) defaultLabel.hidden = true;
    if (tabs) {
        tabs.hidden = false;
        tabs.setAttribute('aria-label', getCurrentLanguage() === 'en' ? 'Prompt type' : '提示词类型');
        tabs.querySelectorAll('[data-prompt-media-type]').forEach((button) => {
            const type = button.dataset.promptMediaType;
            const available = currentPromptMediaVariants.some((variant) => variant.type === type);
            button.hidden = !available;
            button.textContent = getPromptMediaTabLabel(type);
            button.setAttribute('aria-label', getPromptMediaTabLabel(type));
            button.onclick = () => selectPromptMediaType(type);
            button.onkeydown = (event) => handlePromptMediaTabKeydown(event, type);
        });
    }
    const preferredType = currentPromptMediaVariants.some((variant) => variant.type === currentPromptMediaType)
        ? currentPromptMediaType
        : (currentPromptMediaVariants.find((variant) => variant.type === 'image') || currentPromptMediaVariants[0]).type;
    selectPromptMediaType(preferredType);
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
        renderPromptMediaTabs(promptText, item);
        return;
    }
    resetPromptMediaTabs({ resetItem: true });
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
        if (hasPromptDetailBody(item)) {
            renderPromptMediaTabs(promptText, item);
        } else {
            resetPromptMediaTabs({ resetItem: true });
            setPromptDetailTextState(promptText, getPromptDetailUnavailableText());
        }
    }
    currentModalImagePalettes = normalizePromptImagePalettesFromRecord(item);
    renderModalImagePalette();
}

function findPromptForModalOpen(id) {
    const normalizedId = String(id ?? '').trim();
    if (!normalizedId || !Array.isArray(PROMPTS)) return null;

    return PROMPTS.find((prompt) => (
        String(prompt?.supabaseId ?? prompt?.supabase_id ?? '').trim() === normalizedId
    ))
        || PROMPTS.find((prompt) => String(prompt?.id ?? '').trim() === normalizedId)
        || null;
}

let promptCardClickFallbackSessionId = '';

function getPromptCardClickSessionId() {
    const trackerSessionId = String(window.UserEventTracker?.getSessionId?.() || '').trim();
    if (trackerSessionId) return trackerSessionId;

    const storageKey = 'prompt-card-click:session-id';
    try {
        const storedSessionId = String(sessionStorage.getItem(storageKey) || '').trim();
        if (storedSessionId) return storedSessionId;

        const generatedSessionId = typeof window.crypto?.randomUUID === 'function'
            ? `prompt_${window.crypto.randomUUID()}`
            : `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        sessionStorage.setItem(storageKey, generatedSessionId);
        return generatedSessionId;
    } catch (error) {
        if (!promptCardClickFallbackSessionId) {
            promptCardClickFallbackSessionId = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        }
        return promptCardClickFallbackSessionId;
    }
}

function recordPromptCardClick(promptId) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId || !window.supabaseClient?.rpc) return;

    const site = window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
    const dedupeKey = `prompt-card-click:${site}:${normalizedPromptId}`;
    try {
        if (sessionStorage.getItem(dedupeKey)) return;
    } catch (error) {
        // Database-side session deduplication still protects the metric.
    }

    const sessionId = getPromptCardClickSessionId();
    void window.supabaseClient.rpc('fn_record_prompt_card_click', {
        p_prompt_id: normalizedPromptId,
        p_site: site,
        p_session_id: sessionId
    }).then(({ data, error } = {}) => {
        if (error) throw error;
        if (data !== true) return;
        try {
            sessionStorage.setItem(dedupeKey, '1');
        } catch (storageError) {
            // Database-side session deduplication remains authoritative.
        }
    }).catch((error) => {
        console.debug('[PromptSort] Card click count failed:', error?.message || error);
    });
}

function openPromptModal(id, options = {}) {
    const item = findPromptForModalOpen(id);
    if (!item) return;
    const detailPromise = ensurePromptDetailLoaded(item);

    promptModalBaseScrollY = window.scrollY || window.pageYOffset || 0;

    currentPromptId = getPromptStableOpenId(item);
    const modalPromptId = String(currentPromptId || '').trim();
    recordPromptCardClick(modalPromptId);
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
    const promptArea = document.getElementById('promptArea');
    const shouldAnimateRelatedSelection = options.animateRelatedSelection === true
        && isPromptModalMobileLayout()
        && modal?.classList.contains('active')
        && modalInner?.classList.contains('related-mode');
    const shouldAnimateDesktopRelatedSelection = options.animateRelatedSelection === true
        && !isPromptModalMobileLayout()
        && modal?.classList.contains('active')
        && modalInner?.classList.contains('related-mode');
    const desktopRelatedSelectionPromptPrepared = shouldAnimateDesktopRelatedSelection
        ? prepareDesktopRelatedSelectionPromptArea(promptArea)
        : false;
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
    closePromptCommentInputDock({ clearDraft: true, immediate: true, reason: 'modal-open-reset' });
    releasePromptModalCommentModeGeometry();

    // Reset State
    cancelRelatedPromptWork();
    isCommentMode = false;
    isRelatedMode = false;
    promptModalLayoutWasMobile = isPromptModalMobileLayout();
    clearPromptCommentModeReturnState(modalInner);
    if (shouldAnimateRelatedSelection) {
        modalInner?.classList.add('comment-mode-returning');
    }
    modalInner?.classList.remove('comment-mode', 'related-mode', 'related-mode-entering');
    backdrop?.classList.add('visible');

    // Reset side panel button state to match
    resetPromptDetailSideModeButtons();
    syncPromptModalTopButtonState();

    // Reset Prompt Area (in case it was docked/moved)
    const contentCol = document.querySelector('.modal-content-col');
    if (contentCol) {
        contentCol.scrollTop = 0;
    }
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
    renderPromptModalSourceActions(item);

    // Reset unlock lock for new prompt
    _unlockInProgress = false;

    // Reset copy lock for new prompt
    _copyInProgress = false;

    // Store images for navigation
    const modalVideoAssets = getPromptVideoAssets(item);
    currentModalVideoAsset = modalVideoAssets[0] || null;
    const modalImageEntries = getPromptModalImageEntries(item);
    currentModalImages = modalImageEntries.map((entry) => entry.imageUrl);
    currentModalImageThumbs = modalImageEntries.map((entry) => entry.thumbUrl || entry.imageUrl);
    currentModalImagePalettes = normalizePromptImagePalettesFromRecord(item);
    if (currentModalVideoAsset) {
        const poster = currentModalVideoAsset.poster || currentModalImages[0] || '';
        currentModalImages = poster ? [poster] : [];
        currentModalImageThumbs = poster ? [poster] : [];
    }
    currentModalImageIndex = 0;
    currentModalThumbRenderKey = '';
    cancelModalImageThumbnailWarmup();

    // Reset Image Container - remove ALL images (including leftovers from transitions)
    const imgContainer = document.querySelector('.modal-image-col');
    const allMedia = imgContainer.querySelectorAll('img, video');
    allMedia.forEach((media) => media.remove());

    // Reset animation lock
    isModalImageAnimating = false;

    // Create fresh image
    const newMedia = currentModalVideoAsset
        ? document.createElement('video')
        : document.createElement('img');
    if (currentModalVideoAsset) {
        newMedia.id = 'modalVideo';
        newMedia.className = 'active prompt-modal-video';
        newMedia.src = currentModalVideoAsset.original;
        newMedia.poster = currentModalVideoAsset.poster || currentModalImages[0] || '';
        newMedia.controls = true;
        newMedia.playsInline = true;
        newMedia.preload = 'metadata';
        newMedia.setAttribute('controlsList', 'nodownload');
        newMedia.setAttribute('aria-label', getLocalizedField(item, 'title') || 'Prompt video');
    } else {
        newMedia.id = 'modalImg';
        newMedia.className = 'active';
        disablePromptImageDrag(newMedia);
        newMedia.src = currentModalImages[0] || '';
        newMedia.alt = getLocalizedField(item, 'title');
    }

    // Insert before nav buttons
    const firstBtn = imgContainer.querySelector('.modal-img-nav');
    imgContainer.insertBefore(newMedia, firstBtn);
    if (newMedia.tagName === 'IMG') {
        newMedia.addEventListener('load', () => requestAnimationFrame(syncModalImagePaletteSurface), { once: true });
    }

    // Populate Data (with i18n support)
    document.getElementById('modalTitle').textContent = getLocalizedField(item, 'title');
    document.getElementById('modalDesc').textContent = getLocalizedField(item, 'description');

    // Set prompt text (ensure clean connection) - use localized version if available
    setPromptModalPromptContent(promptText, item);
    if (shouldAnimateRelatedSelection) {
        startPromptDetailReturnReveal(modalInner, { isMobileLayout: true });
    }
    animateDesktopRelatedSelectionPromptArea(promptArea, desktopRelatedSelectionPromptPrepared);
    syncPromptModalUnlockPriceState();
    detailPromise
        .then((updatedItem) => {
            if (String(currentPromptId || '').trim() !== modalPromptId) return;
            applyPromptModalDetailContent(updatedItem);
            renderPromptModalSourceActions(updatedItem);
            if (isRelatedMode) {
                scheduleRelatedPromptsRender(updatedItem);
            } else {
                scheduleRelatedPromptWarmup(updatedItem);
            }
            syncPromptModalUnlockPriceState();
        })
        .catch((error) => {
            console.warn('Failed to load prompt detail:', error?.message || error);
            if (String(currentPromptId || '').trim() === modalPromptId) {
                resetPromptMediaTabs({ resetItem: true });
                setPromptDetailTextState(promptText, getPromptDetailUnavailableText());
            }
        });

    // Tags hidden as per user request
    const tagsContainer = document.getElementById('modalTags');
    tagsContainer.innerHTML = ''; // Hidden

    syncModalImageNavigationState();

    // Reset Comments
    const commentList = document.getElementById('commentList');
    if (commentList) {
        commentList.classList.remove('comment-list-empty');
        commentList.innerHTML = '';
    }
    applyPromptCommentCount(currentPromptId, getCachedPromptCommentCount(currentPromptId));
    lastRenderedRelatedPromptKey = '';
    const relatedGrid = document.getElementById('relatedPromptGrid');
    if (relatedGrid) {
        relatedGrid.classList.remove('related-prompt-grid--empty');
        relatedGrid.innerHTML = '';
    }

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
    scheduleRelatedPromptWarmup(item);
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

function startPromptDetailReturnReveal(modalInner, { isMobileLayout = isPromptModalMobileLayout() } = {}) {
    const revealPromptDetailContent = () => {
        if (!modalInner?.classList.contains('comment-mode-returning')) return;
        modalInner.classList.add('comment-mode-title-revealing');
    };
    if (isMobileLayout) {
        revealPromptDetailContent();
    } else {
        requestAnimationFrame(revealPromptDetailContent);
    }
    promptCommentModeReturnTimer = setTimeout(() => {
        if (modalInner) {
            modalInner.classList.remove('comment-mode-returning', 'comment-mode-title-revealing');
        }
        promptCommentModeReturnTimer = null;
    }, isMobileLayout ? PROMPT_MOBILE_SIDE_MODE_RETURN_CLEANUP_MS : PROMPT_DESKTOP_SIDE_MODE_RETURN_CLEANUP_MS);
}

function closePromptDetailSideMode() {
    const modalInner = document.querySelector('.modal-inner');
    const isMobileLayout = isPromptModalMobileLayout();
    const wasSideModeActive = isPromptDetailSideModeActive();
    const wasDesktopDocked = !isMobileLayout && wasSideModeActive;

    if (isMobileLayout && wasSideModeActive) {
        lockPromptModalCommentModeGeometry({ force: true });
    }
    clearPromptDetailSideMode({ resetButtons: true, resetClasses: false, releaseGeometry: !isMobileLayout });
    clearPromptCommentModeReturnState(modalInner);
    if (modalInner) {
        modalInner.classList.add('comment-mode-returning');
        modalInner.classList.remove('comment-mode', 'related-mode', 'related-mode-entering');
    }
    if (isMobileLayout) {
        requestAnimationFrame(() => {
            releasePromptModalCommentModeGeometry();
        });
    }
    startPromptDetailReturnReveal(modalInner, { isMobileLayout });
    updateCommentSectionHeading();

    if (wasDesktopDocked) {
        animatePromptAreaFromDock();
    }
}

function resetRelatedPromptScrollPosition() {
    const relatedGrid = document.getElementById('relatedPromptGrid');
    if (relatedGrid) {
        relatedGrid.scrollTop = 0;
    }
}

function openPromptDetailSideMode(mode) {
    const modalInner = document.querySelector('.modal-inner');
    const isMobileLayout = isPromptModalMobileLayout();
    const wasSideModeActive = isPromptDetailSideModeActive();
    const normalizedMode = mode === 'related' ? 'related' : 'comment';

    setCommentSortDropdownOpen(false);
    closePromptCommentInputDock({ reason: 'side-mode-change' });
    clearPromptCommentModeReturnState(modalInner);
    isCommentMode = normalizedMode === 'comment';
    isRelatedMode = normalizedMode === 'related';
    modalInner?.classList.add('comment-mode');
    modalInner?.classList.toggle('related-mode', isRelatedMode);
    if (isMobileLayout && isCommentMode) {
        preparePromptCommentModeInputDock();
    }
    scheduleModalImageThumbnailPlacementSync();
    setPromptCommentTriggerActive(isCommentMode);
    setPromptRelatedTriggerActive(isRelatedMode);
    updateCommentSectionHeading();
    syncPromptModalTopButtonState();

    if (isCommentMode) {
        fetchComments(currentPromptId);
    } else {
        resetRelatedPromptScrollPosition();
        renderRelatedPromptsForActiveMode(findPromptAnalyticsItem(), {
            forceDefer: isMobileLayout,
            animateEntry: true
        });
    }

    if (!isMobileLayout || isCommentMode) {
        lockPromptModalCommentModeGeometry({ force: true, defer: true });
    }

    if (!isMobileLayout && !wasSideModeActive) {
        animatePromptAreaToDock();
    }

    if (isPromptModalKeyboardDockEnabled()) {
        requestAnimationFrame(() => capturePromptModalDockMetrics(true));
    }
}

function toggleCommentMode() {
    if (isCommentMode) {
        closePromptDetailSideMode();
        return;
    }

    openPromptDetailSideMode('comment');
}

function toggleRelatedMode() {
    if (isRelatedMode) {
        closePromptDetailSideMode();
        return;
    }

    openPromptDetailSideMode('related');
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
let _freeUnlockDailyLimit = 3;
let _copyInProgress = false; // 防止重复复制操作

function getPromptRuntimeSite() {
    return window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
}

function normalizePromptUnlockPrice(value, fallback = 1) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(0, Math.trunc(parsed));
}

function normalizePromptFreeDailyLimit(value, fallback = 3) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(0, Math.trunc(parsed));
}

function getPromptUnlockErrorMessage(errorLike) {
    const rawMessage = String(
        errorLike?.message
        || errorLike?.error
        || errorLike
        || ''
    ).trim();
    const rawCode = String(errorLike?.code || '').trim();

    if (rawCode === 'free_daily_limit_reached' || rawMessage.includes('免费解锁次数已用完')) {
        return '今天的免费解锁次数已经用完了，明天再来解锁吧。';
    }

    if (rawCode === 'unlock_price_changed' || rawMessage.includes('解锁价格已更新')) {
        return '解锁价格刚刚更新了，请刷新页面后再试。';
    }

    if (rawMessage.includes('积分不足') || rawMessage.includes('Insufficient')) {
        return '积分余额不足，请先充值后再解锁。';
    }

    if (
        rawMessage.includes('Could not choose the best candidate function')
        || rawMessage.includes('multiple functions')
        || rawMessage.includes('function between')
        || rawMessage.includes('PGRST203')
    ) {
        return '解锁服务刚刚更新中，请刷新页面后再试一次。';
    }

    if (rawMessage.includes('Failed to fetch') || rawMessage.includes('NetworkError')) {
        return '网络连接不稳定，请稍后再试。';
    }

    if (rawMessage) {
        return rawMessage.length > 120 ? '解锁失败，请刷新页面后再试。' : rawMessage;
    }

    return '解锁失败，请刷新页面后再试。';
}

function syncPromptUnlockButtonPrice() {
    const unlockBtn = document.getElementById('unlockPromptBtn');
    if (!unlockBtn || _unlockInProgress || unlockBtn.classList.contains('copy-btn')) {
        return;
    }
    unlockBtn.innerHTML = `<i class="fas fa-gem"></i> ${_unlockPrice}`;
}

function resetPromptUnlockButton(btn = document.getElementById('unlockPromptBtn'), fallbackHTML = '') {
    if (!btn || btn.classList.contains('copy-btn')) {
        return;
    }

    btn.innerHTML = fallbackHTML || `<i class="fas fa-gem"></i> ${_unlockPrice}`;
    btn.disabled = false;
}

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

// 从公共站点配置加载解锁价格配置
async function loadUnlockPrice() {
    try {
        const url = new URL('/api/public', window.location.origin);
        url.searchParams.set('scope', 'config');
        url.searchParams.set('route', 'site-system-config');
        url.searchParams.set('site', getPromptRuntimeSite());
        url.searchParams.append('key', 'unlock_pricing');

        const response = await fetch(url.toString(), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || '加载解锁价格配置失败');
        }

        const config = payload?.configs?.unlock_pricing;
        if (config && Object.prototype.hasOwnProperty.call(config, 'default_points')) {
            _unlockPrice = normalizePromptUnlockPrice(config.default_points, 1);
            _freeUnlockDailyLimit = normalizePromptFreeDailyLimit(config.free_daily_limit, 3);
            syncPromptUnlockButtonPrice();
            syncPromptModalUnlockPriceState();
            console.log('[Unlock] Price loaded from config:', _unlockPrice, 'free daily limit:', _freeUnlockDailyLimit);
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
            resetPromptUnlockButton(btn, originalHTML);
            return;
        }

        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) {
            resetPromptUnlockButton(btn, originalHTML);
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
            const errMsg = getPromptUnlockErrorMessage(data || '解锁失败');
            const hasInsufficientPoints = errMsg.includes('积分不足') || errMsg.includes('Insufficient');
            const hasFreeDailyLimit = data?.code === 'free_daily_limit_reached' || errMsg.includes('免费解锁次数');
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
            if (hasFreeDailyLimit) {
                triggerPromptUnlockEngagement('prompt_free_unlock_limit_reached', currentPromptId, {
                    source: 'unlock_free_daily_limit',
                    source_event_id: `prompt_free_daily_limit:prompts:${String(currentPromptId || '').trim() || 'unknown'}:${Date.now()}`,
                    category: promptMetadata.category || null,
                    free_daily_limit: _freeUnlockDailyLimit,
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
                resetPromptUnlockButton(btn, originalHTML);
            }
        }
    } catch (err) {
        console.error('[Unlock] Error:', err);
        alert(getPromptUnlockErrorMessage(err));
        if (btn) {
            resetPromptUnlockButton(btn, originalHTML);
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
    const promptItem = findPromptForModalOpen(promptId);
    if (promptItem) {
        if (hasPromptDetailBody(promptItem)) {
            renderPromptMediaTabs(promptText, promptItem);
        } else {
            setPromptDetailLoadingState(promptText);
            ensurePromptDetailLoaded(promptItem)
                .then((updatedItem) => {
                    if (currentPromptId !== promptId) return;
                    if (hasPromptDetailBody(updatedItem)) {
                        renderPromptMediaTabs(promptText, updatedItem);
                    } else {
                        resetPromptMediaTabs({ resetItem: true });
                        setPromptDetailTextState(promptText, getPromptDetailUnavailableText());
                    }
                })
                .catch((error) => {
                    console.warn('Failed to load unlocked prompt detail:', error?.message || error);
                    if (currentPromptId === promptId) {
                        resetPromptMediaTabs({ resetItem: true });
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

function syncPromptModalUnlockPriceState() {
    if (normalizePromptUnlockPrice(_unlockPrice, 1) === 0 && currentPromptId) {
        setPromptUnlocked();
    }
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
let promptCommentInputDock = null;

function isPromptCommentInputDockEnabled() {
    const coarsePointer = window.matchMedia?.('(any-pointer: coarse)')?.matches;
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    return isPromptModalMobileLayout()
        && (coarsePointer || navigator.maxTouchPoints > 0 || mobileUserAgent)
        && typeof window.PromptCommentInputDock === 'function';
}

function getPromptCommentInputCopy() {
    return {
        placeholder: window.i18n?.t('gallery.commentComposerPlaceholder') || '写下你的评论…',
        addComment: window.i18n?.t('gallery.addComment') || '添加评论...',
        attachImage: window.i18n?.t('gallery.attachImage') || '添加图片',
        imageAttached: window.i18n?.t('gallery.imageAttached') || '已添加图片',
        imageSelected: window.i18n?.t('gallery.imageSelected') || '已选择图片',
        imageSelectedLabel: window.i18n?.t('gallery.imageSelectedLabel') || '已选择',
        imageCompressedLabel: window.i18n?.t('gallery.imageCompressedLabel') || '已压缩',
        tapToRemove: window.i18n?.t('gallery.tapToRemove') || '点击移除',
        removeSelectedImageConfirm: window.i18n?.t('gallery.removeSelectedImageConfirm') || '移除已选择的图片？',
        selectImageFileError: window.i18n?.t('gallery.selectImageFileError') || '请选择图片文件',
        compressingImage: window.i18n?.t('gallery.compressingImage') || '正在压缩图片…',
        imageCompressFailed: window.i18n?.t('gallery.imageCompressFailed') || '图片压缩失败，请重试'
    };
}

function buildCommentImageUploadTitle(file, finalFile, compressed) {
    const copy = getPromptCommentInputCopy();
    const originalSize = (file.size / 1024).toFixed(0);
    const compressedSize = (finalFile.size / 1024).toFixed(0);

    if (compressed === file) {
        return copy.imageSelectedLabel + ': ' + file.name + ' (' + originalSize + 'KB)';
    }

    return copy.imageCompressedLabel + ': ' + file.name + ' (' + originalSize + 'KB -> '
        + compressedSize + 'KB, ' + copy.tapToRemove + ')';
}

function refreshCommentImageUploadLanguageUI() {
    const copy = getPromptCommentInputCopy();
    getCommentImageUploadBindings().forEach(({ button }) => {
        button.dataset.defaultTitle = copy.attachImage;
        button.title = selectedCommentImage ? copy.imageSelected : copy.attachImage;
        button.setAttribute('aria-label', button.title);
    });
}

function copyPromptCommentInputDatasets(source, target) {
    if (!source || !target) return;
    ['replyTo', 'replyToName'].forEach((key) => {
        if (source.dataset[key]) target.dataset[key] = source.dataset[key];
        else delete target.dataset[key];
    });
}

function getPromptCommentInputMeta(source = promptCommentInputDock?.input) {
    const pieces = [];
    if (source?.dataset.replyToName) {
        pieces.push((window.i18n?.t('gallery.replyingTo') || '回复') + ' @' + source.dataset.replyToName);
    }
    if (selectedCommentImage) {
        pieces.push(getPromptCommentInputCopy().imageAttached);
    }
    return pieces.join(' · ');
}

function updatePromptCommentInputTrigger() {
    const canonicalInput = document.getElementById('commentInput');
    const trigger = document.getElementById('commentInputTrigger');
    const triggerText = document.getElementById('commentInputTriggerText');
    const triggerArea = trigger?.closest('.comment-input-area');
    if (!canonicalInput || !trigger || !triggerText || !triggerArea) return;

    const copy = getPromptCommentInputCopy();
    const draft = canonicalInput.value.trim();
    triggerText.textContent = draft || copy.addComment;
    triggerText.dataset.placeholder = copy.addComment;
    trigger.setAttribute('aria-label', draft ? copy.placeholder : copy.addComment);
    triggerArea.classList.toggle('has-draft', Boolean(draft) || Boolean(selectedCommentImage));
}

function syncPromptCommentInputDraft(source = promptCommentInputDock?.input) {
    const canonicalInput = document.getElementById('commentInput');
    if (!canonicalInput || !source) return;
    canonicalInput.value = source.value;
    copyPromptCommentInputDatasets(source, canonicalInput);
    updatePromptCommentInputTrigger();
    promptCommentInputDock?.setMeta(getPromptCommentInputMeta(source));
}

function clearCommentDraftFields() {
    const canonicalInput = document.getElementById('commentInput');
    if (canonicalInput) {
        canonicalInput.value = '';
        delete canonicalInput.dataset.replyTo;
        delete canonicalInput.dataset.replyToName;
        resetPromptsTextareaAutoHeight(canonicalInput);
    }
    if (promptCommentInputDock?.input) {
        promptCommentInputDock.setValue('');
        promptCommentInputDock.setMeta('');
    }
    updatePromptCommentInputTrigger();
}

function ensurePromptCommentInputDock() {
    if (!isPromptCommentInputDockEnabled()) return null;
    if (promptCommentInputDock) return promptCommentInputDock;

    const copy = getPromptCommentInputCopy();
    promptCommentInputDock = new window.PromptCommentInputDock({
        rootId: 'promptCommentInputDock',
        inputId: 'promptCommentInputDockField',
        metaId: 'promptCommentInputDockMeta',
        placeholder: copy.placeholder,
        getScrollPosition: () => ({
            x: window.scrollX || window.pageXOffset || 0,
            y: getPromptModalBaseScrollY()
        }),
        onInput: (_value, input) => {
            syncPromptCommentInputDraft(input);
        },
        onBeforeDismiss: (input) => {
            syncPromptCommentInputDraft(input);
        },
        onKeydown: (event) => {
            handleCommentKeydown(event);
        },
        onStateChange: () => {
            syncPromptModalTopButtonState();
        }
    });
    return promptCommentInputDock;
}

function refreshPromptCommentInputLanguageUI() {
    const copy = getPromptCommentInputCopy();
    promptCommentInputDock?.setPlaceholder(copy.placeholder);
    if (promptCommentInputDock?.input) {
        promptCommentInputDock.setMeta(getPromptCommentInputMeta(promptCommentInputDock.input));
    }
    updatePromptCommentInputTrigger();
}

function openPromptCommentInputDock(options = {}) {
    const dock = ensurePromptCommentInputDock();
    const canonicalInput = document.getElementById('commentInput');
    if (!dock || !canonicalInput) return false;

    const value = options.value !== undefined ? options.value : canonicalInput.value;
    const replyTo = options.replyTo !== undefined ? options.replyTo : canonicalInput.dataset.replyTo;
    const replyToName = options.replyToName !== undefined
        ? options.replyToName
        : canonicalInput.dataset.replyToName;

    canonicalInput.value = value || '';
    if (replyTo) canonicalInput.dataset.replyTo = replyTo;
    else delete canonicalInput.dataset.replyTo;
    if (replyToName) canonicalInput.dataset.replyToName = replyToName;
    else delete canonicalInput.dataset.replyToName;

    updatePromptCommentInputTrigger();
    const opened = dock.open({
        value: canonicalInput.value,
        replyTo,
        replyToName,
        placeholder: getPromptCommentInputCopy().placeholder,
        meta: getPromptCommentInputMeta(canonicalInput)
    });
    syncPromptModalTopButtonState();
    return opened;
}

function closePromptCommentInputDock({
    blur = true,
    immediate = false,
    clearDraft = false,
    reason = 'close'
} = {}) {
    if (clearDraft) {
        clearCommentDraftFields();
        clearSelectedCommentImage();
    } else if (promptCommentInputDock?.input) {
        syncPromptCommentInputDraft(promptCommentInputDock.input);
    }

    if (!promptCommentInputDock?.isActive()) return false;
    return promptCommentInputDock.close({ blur, immediate, reason });
}

function getActiveCommentInput() {
    if (promptCommentInputDock?.isActive() && promptCommentInputDock.input) {
        return promptCommentInputDock.input;
    }
    return document.getElementById('commentInput');
}
function getCommentImageUploadBindings() {
    return [
        {
            button: document.getElementById('commentUploadBtn'),
            input: document.getElementById('commentImageUpload')
        }
    ].filter(binding => binding.button && binding.input);
}

function updateCommentImageUploadButtonsState(title = null) {
    const bindings = getCommentImageUploadBindings();
    const copy = getPromptCommentInputCopy();
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
    if (promptCommentInputDock?.input) {
        promptCommentInputDock.setMeta(getPromptCommentInputMeta(promptCommentInputDock.input));
    }
    updatePromptCommentInputTrigger();
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
            button.dataset.defaultTitle = getPromptCommentInputCopy().attachImage;
        }

        const handleUpload = () => {
            if (selectedCommentImage) {
                if (confirm(getPromptCommentInputCopy().removeSelectedImageConfirm)) {
                    clearSelectedCommentImage();
                }
                return;
            }

            input.click();
        };
        button.onclick = handleUpload;

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                alert(getPromptCommentInputCopy().selectImageFileError);
                input.value = '';
                return;
            }

            bindings.forEach(({ button: eachButton }) => {
                eachButton.disabled = true;
                eachButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                eachButton.title = getPromptCommentInputCopy().compressingImage;
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
                alert(getPromptCommentInputCopy().imageCompressFailed);
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
            <img src="" alt="Full size" draggable="false" />
        `;
        document.body.appendChild(lightbox);
        lightbox.querySelector('.lightbox-close')?.addEventListener('click', () => {
            closeImageLightbox();
        });
    }

    // Set image and show
    const img = lightbox.querySelector('img');
    disablePromptImageDrag(img);
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
        const item = findPromptForModalOpen(promptId);
        const stablePromptId = getPromptStableOpenId(item);
        if (item && (card.dataset.promptId === stablePromptId || String(card.dataset.id || '') === String(item.id ?? ''))) {
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
        <img src="${avatarUrl}" class="comment-avatar" alt="${name}" draggable="false">
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
    const input = document.getElementById('commentInput');
    if (input) {
        input.value = `@${authorName} `;
        input.dataset.replyTo = commentId;
        input.dataset.replyToName = authorName;

        if (isPromptCommentInputDockEnabled()) {
            updatePromptCommentInputTrigger();
            openPromptCommentInputDock({
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
        if (isPromptCommentInputDockEnabled() && e.target?.id === 'promptCommentInputDockField') {
            return;
        }
        e.preventDefault(); // Prevent newline
        void submitComment({ source: 'keyboard' });
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

    if (input.id === 'promptCommentInputDockField') {
        promptCommentInputDock?.syncHeight();
        syncPromptCommentInputDraft(input);
    } else {
        autoExpandTextarea(input);
        updatePromptCommentInputTrigger();
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

async function submitComment(options = {}) {
    if (!window.supabaseClient) return;

    const input = getActiveCommentInput();
    if (!input) return;
    const content = input.value.trim();
    const site = getPromptInteractionSite();
    const isPromptDockInput = input?.id === 'promptCommentInputDockField';

    // Allow empty content only when an image is attached. Check this before auth
    // so keyboard Return/Done events on an empty composer cannot summon login.
    if (!content && !selectedCommentImage) {
        return;
    }

    // Authenticate only after there is real work to submit.
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        if (isPromptDockInput && isPromptCommentInputDockEnabled()) {
            closePromptCommentInputDock({ reason: 'authentication-required' });
        }
        showLoginModal();
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

    if (isPromptCommentInputDockEnabled()) {
        closePromptCommentInputDock({ clearDraft: true, reason: 'comment-submitted' });
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
    refreshPromptCommentInputLanguageUI();
    sanitizeCommentSortTopUI();

    const commentInput = document.getElementById('commentInput');
    if (commentInput) {
        commentInput.setAttribute(
            'placeholder',
            window.i18n?.t('gallery.addComment') || 'Add a comment...'
        );
    }
    updatePromptCommentInputTrigger();

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

document.addEventListener('DOMContentLoaded', () => {
    promptModalLayoutWasMobile = isPromptModalMobileLayout();
    window.addEventListener('resize', requestPromptModalLayoutModeSync, { passive: true });
    window.addEventListener('orientationchange', requestPromptModalLayoutModeSync, { passive: true });
    window.visualViewport?.addEventListener('resize', requestPromptModalLayoutModeSync, { passive: true });
    window.addEventListener('resize', syncModalImagePaletteSurface, { passive: true });
    window.addEventListener('orientationchange', syncModalImagePaletteSurface, { passive: true });

    setupCommentSorting();

    const commentInput = document.getElementById('commentInput');
    const commentInputTrigger = document.getElementById('commentInputTrigger');
    if (commentInput) {
        initCommentImageUpload();
        document.getElementById('sendCommentBtn')?.addEventListener('click', () => {
            void submitComment({ source: 'comment-send' });
        });

        if (isPromptCommentInputDockEnabled() && commentInputTrigger) {
            const commentInputArea = commentInput.closest('.comment-input-area');
            const launchDock = (event) => {
                if (event?.cancelable) event.preventDefault();
                event?.stopPropagation?.();
                openPromptCommentInputDock();
            };

            ensurePromptCommentInputDock();
            commentInputArea?.classList.add('comment-input-dock-enabled');
            updatePromptCommentInputTrigger();
            commentInputTrigger.addEventListener('pointerdown', (event) => {
                if (event.button !== undefined && event.button !== 0) return;
                launchDock(event);
            });
            commentInputTrigger.addEventListener('click', (event) => {
                if (event.detail !== 0) {
                    event.preventDefault();
                    return;
                }
                launchDock(event);
            });
            window.i18n?.ready?.().then(() => refreshCommentLanguageUI());
            return;
        }

        commentInput.addEventListener('keydown', handleCommentKeydown);
        commentInput.addEventListener('input', () => autoExpandTextarea(commentInput));

        const handleTouchFocus = () => {
            if (!isPromptModalIOSMobile() || document.activeElement === commentInput) return;
            const scrollClamp = () => {
                if (window.scrollY !== 0 || window.scrollX !== 0) {
                    window.scrollTo(0, 0);
                }
            };
            window.addEventListener('scroll', scrollClamp, { passive: true });
            window.scrollTo(0, 0);
            try {
                commentInput.focus({ preventScroll: true });
            } catch (_) {
                commentInput.focus();
            }
            window.scrollTo(0, 0);
            setTimeout(() => {
                window.removeEventListener('scroll', scrollClamp);
                window.scrollTo(0, 0);
            }, 400);
        };
        commentInput.addEventListener('touchstart', handleTouchFocus, { passive: true });
        commentInput.addEventListener('focus', primePromptModalKeyboardDock);
        commentInput.addEventListener('blur', schedulePromptModalUndock);
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
    disablePromptImageDrag(newImg);
    newImg.src = currentModalImages[index];
    newImg.className = 'modal-next-image'; // Position absolute, opacity 0

    // Comment mode keeps the image column pinned; CSS handles the image motion.

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
                requestAnimationFrame(syncModalImagePaletteSurface);

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

    syncModalImageNavigationState();
}

function updateModalCounter() {
    const counter = document.getElementById('modalImgCounter');
    if (counter) {
        counter.textContent = `${currentModalImageIndex + 1} / ${currentModalImages.length}`;
    }
}

function getModalImagePreviewLabel(index) {
    const isEnglish = getCurrentLanguage() === 'en';
    return isEnglish ? `Show image ${index + 1}` : `查看第 ${index + 1} 张图片`;
}

function getModalImageThumbnailRenderKey() {
    return currentModalImages
        .map((url, index) => `${url}::${currentModalImageThumbs[index] || ''}`)
        .join('|');
}

function cancelModalImageThumbnailWarmup() {
    if (currentModalThumbWarmupIdleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(currentModalThumbWarmupIdleId);
    }
    if (currentModalThumbWarmupTimerId) {
        clearTimeout(currentModalThumbWarmupTimerId);
    }
    currentModalThumbWarmupIdleId = null;
    currentModalThumbWarmupTimerId = null;
}

function warmModalImageThumbnails(urls = currentModalImageThumbs) {
    Array.from(new Set(urls.filter(Boolean))).forEach((url, index) => {
        const image = new Image();
        image.decoding = 'async';
        if ('fetchPriority' in image) {
            image.fetchPriority = index < 4 ? 'high' : 'low';
        }
        image.src = url;
        if (typeof image.decode === 'function') {
            image.decode().catch(() => {});
        }
    });
}

function scheduleModalImageThumbnailWarmup() {
    cancelModalImageThumbnailWarmup();
    if (currentModalImageThumbs.length <= 1) return;

    const renderKey = getModalImageThumbnailRenderKey();
    const urls = currentModalImageThumbs.slice();
    const run = () => {
        currentModalThumbWarmupIdleId = null;
        currentModalThumbWarmupTimerId = null;
        if (renderKey !== getModalImageThumbnailRenderKey()) return;
        warmModalImageThumbnails(urls);
    };

    if (typeof window.requestIdleCallback === 'function') {
        currentModalThumbWarmupIdleId = window.requestIdleCallback(run, { timeout: 180 });
        return;
    }

    currentModalThumbWarmupTimerId = window.setTimeout(run, 60);
}

function syncModalImageThumbnailActiveState(thumbs = document.getElementById('modalImgThumbnails')) {
    if (!thumbs) return;
    thumbs.querySelectorAll('.modal-img-thumb-btn').forEach((button) => {
        const index = Number(button.dataset.imageIndex);
        const isCurrent = index === currentModalImageIndex;
        button.classList.toggle('is-current', isCurrent);
        button.setAttribute('aria-hidden', isCurrent ? 'true' : 'false');
        button.tabIndex = isCurrent ? -1 : 0;
    });
}

function syncModalImageThumbnailPlacement() {
    const imageCol = document.querySelector('#promptModal .modal-image-col');
    if (!imageCol) return;

    const promptArea = document.getElementById('promptArea');
    const shouldLiftAboveDockedPrompt = Boolean(
        promptArea?.classList.contains('docked')
        && promptArea.parentElement?.id === 'promptDockTarget'
    );

    if (!shouldLiftAboveDockedPrompt) {
        imageCol.style.removeProperty('--modal-img-thumbs-docked-bottom');
        return;
    }

    const promptHeight = Math.ceil(promptArea.getBoundingClientRect().height || promptArea.offsetHeight || 0);
    const dockBottom = 16;
    const visualGap = 14;
    imageCol.style.setProperty('--modal-img-thumbs-docked-bottom', `${Math.max(140, promptHeight + dockBottom + visualGap)}px`);
}

function scheduleModalImageThumbnailPlacementSync() {
    requestAnimationFrame(() => {
        syncModalImageThumbnailPlacement();
    });
}

function renderModalImageThumbnails() {
    const thumbs = document.getElementById('modalImgThumbnails');
    if (!thumbs) return;

    const hasMultipleImages = currentModalImages.length > 1;
    thumbs.classList.toggle('is-visible', hasMultipleImages);
    scheduleModalImageThumbnailPlacementSync();

    if (!hasMultipleImages) {
        thumbs.innerHTML = '';
        currentModalThumbRenderKey = '';
        cancelModalImageThumbnailWarmup();
        return;
    }

    const renderKey = getModalImageThumbnailRenderKey();
    if (renderKey === currentModalThumbRenderKey) {
        syncModalImageThumbnailActiveState(thumbs);
        scheduleModalImageThumbnailPlacementSync();
        return;
    }

    thumbs.innerHTML = '';
    currentModalImages.forEach((imageUrl, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'modal-img-thumb-btn';
        button.dataset.imageIndex = String(index);
        button.setAttribute('aria-label', getModalImagePreviewLabel(index));

        const img = document.createElement('img');
        img.src = currentModalImageThumbs[index] || imageUrl;
        img.alt = '';
        img.loading = 'eager';
        img.decoding = 'async';
        img.width = 116;
        img.height = 144;
        img.fetchPriority = index < 4 ? 'high' : 'low';
        disablePromptImageDrag(img);

        button.appendChild(img);
        button.addEventListener('click', () => {
            if (index !== currentModalImageIndex) {
                updateModalImage(index);
            }
        });
        thumbs.appendChild(button);
    });

    currentModalThumbRenderKey = renderKey;
    syncModalImageThumbnailActiveState(thumbs);
    scheduleModalImageThumbnailWarmup();
    scheduleModalImageThumbnailPlacementSync();
}

function getCurrentModalImagePalette() {
    return currentModalImagePalettes.find((palette) => palette.image_index === currentModalImageIndex)
        || currentModalImagePalettes[currentModalImageIndex]
        || null;
}

function getPromptPaletteCopyLabel(hex) {
    return getCurrentLanguage() === 'en' ? `Copy ${hex}` : `复制色号 ${hex}`;
}

function syncModalImagePaletteSurface() {
    const paletteContainer = document.getElementById('modalImagePaletteWide');
    if (!paletteContainer) return;

    paletteContainer.classList.remove('is-over-image');
    if (!paletteContainer.classList.contains('is-visible')) return;

    const image = document.getElementById('modalImg');
    if (!image || !image.naturalWidth || !image.naturalHeight) return;

    const paletteRect = paletteContainer.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    if (paletteRect.width <= 0 || paletteRect.height <= 0 || imageRect.width <= 0 || imageRect.height <= 0) return;

    const imageRatio = image.naturalWidth / image.naturalHeight;
    const boxRatio = imageRect.width / imageRect.height;
    let renderedWidth = imageRect.width;
    let renderedHeight = imageRect.height;

    if (imageRatio > boxRatio) {
        renderedHeight = imageRect.width / imageRatio;
    } else {
        renderedWidth = imageRect.height * imageRatio;
    }

    const renderedImageRect = {
        left: imageRect.left + (imageRect.width - renderedWidth) / 2,
        right: imageRect.right - (imageRect.width - renderedWidth) / 2,
        top: imageRect.top + (imageRect.height - renderedHeight) / 2,
        bottom: imageRect.bottom - (imageRect.height - renderedHeight) / 2
    };
    const overlapWidth = Math.max(
        0,
        Math.min(paletteRect.right, renderedImageRect.right) - Math.max(paletteRect.left, renderedImageRect.left)
    );
    const overlapHeight = Math.max(
        0,
        Math.min(paletteRect.bottom, renderedImageRect.bottom) - Math.max(paletteRect.top, renderedImageRect.top)
    );
    const paletteArea = paletteRect.width * paletteRect.height;
    const overlapRatio = paletteArea > 0 ? (overlapWidth * overlapHeight) / paletteArea : 0;

    // A small edge touch should keep the solid surface; switch to glass only
    // when a meaningful part of the palette actually sits over image pixels.
    paletteContainer.classList.toggle('is-over-image', overlapRatio >= 0.2);
}

async function copyPromptPaletteColor(hex, button) {
    try {
        await writePromptShareTextToClipboard(hex);
        button?.classList.add('copied');
        showGalleryToast(
            getCurrentLanguage() === 'en' ? `${hex} copied` : `已复制 ${hex}`,
            'success',
            1600,
            true
        );
        window.setTimeout(() => button?.classList.remove('copied'), 900);
    } catch (error) {
        showGalleryToast(getCurrentLanguage() === 'en' ? 'Copy failed' : '复制失败', 'error', 1800, true);
    }
}

function renderModalImagePalette() {
    const containers = document.querySelectorAll('[data-prompt-image-palette]');
    if (!containers.length) return;
    const palette = getCurrentModalImagePalette();
    const colors = Array.isArray(palette?.colors) ? palette.colors : [];

    containers.forEach((container) => {
        container.classList.toggle('is-visible', colors.length > 0);
        container.setAttribute('aria-hidden', colors.length ? 'false' : 'true');
        container.replaceChildren();

        colors.forEach((color) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'prompt-image-palette-color';
            button.style.setProperty('--prompt-palette-color', color.hex);
            button.dataset.hex = color.hex;
            const copyLabel = getPromptPaletteCopyLabel(color.hex);
            button.dataset.tooltip = copyLabel;
            button.setAttribute('aria-label', copyLabel);
            button.addEventListener('click', () => copyPromptPaletteColor(color.hex, button));
            container.appendChild(button);
        });
    });

    requestAnimationFrame(syncModalImagePaletteSurface);
}

function syncModalImageNavigationState() {
    const hasMultipleImages = currentModalImages.length > 1;
    const leftArrow = document.getElementById('modalImgNavLeft');
    const rightArrow = document.getElementById('modalImgNavRight');
    const counter = document.getElementById('modalImgCounter');

    leftArrow?.classList.toggle('is-visible', hasMultipleImages);
    rightArrow?.classList.toggle('is-visible', hasMultipleImages);
    counter?.classList.toggle('is-visible', hasMultipleImages);

    if (hasMultipleImages) {
        updateModalCounter();
    }
    renderModalImageThumbnails();
    renderModalImagePalette();
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
    const modalVideo = document.getElementById('modalVideo');
    if (modalVideo) {
        modalVideo.pause();
        modalVideo.removeAttribute('autoplay');
    }
    if (!runPromptModalCloseChromeCleanup()) {
        forceHidePromptModalDuringClose();
        clearPromptModalThemeColor({ restoreDelayMs: 320 });
    }
    hidePromptModalStatusBarShield({ immediate: true });
    cancelRelatedPromptWork();
    cancelModalImageThumbnailWarmup();
    closePromptCommentInputDock({
        clearDraft: true,
        immediate: true,
        reason: 'modal-close'
    });
    setCommentSortDropdownOpen(false);
    if (promptModalLayoutSyncFrameId) {
        cancelAnimationFrame(promptModalLayoutSyncFrameId);
        promptModalLayoutSyncFrameId = null;
    }

    // If closing while a detail side panel is open, revert DOM first to prevent glitches next time.
    if (isPromptDetailSideModeActive()) {
        movePromptAreaToDetailColumn();
        clearPromptDetailSideMode({ resetButtons: true, resetClasses: true });
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
