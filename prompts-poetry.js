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
    if (!url) return '';
    const { format = 'avif' } = options;

    // R2 CDN images - use pre-generated thumbnails
    if (url.includes('cdn.zaoyoe.com/prompts/') && !url.includes('/thumb/')) {
        // Convert: /prompts/xxx.webp → /prompts/thumb/xxx.webp
        return url.replace('/prompts/', '/prompts/thumb/');
    }

    // Supabase Storage images - use the built-in transform endpoint for card-sized WebP delivery
    if (url.includes('supabase.co/storage/v1/object/public/prompt-images/')) {
        try {
            const optimizedUrl = new URL(url);
            optimizedUrl.pathname = optimizedUrl.pathname.replace(
                '/storage/v1/object/public/',
                '/storage/v1/render/image/public/'
            );
            optimizedUrl.searchParams.set('width', '360');
            optimizedUrl.searchParams.set('height', '270');
            optimizedUrl.searchParams.set('quality', '80');
            if (format) {
                optimizedUrl.searchParams.set('format', format);
            } else {
                optimizedUrl.searchParams.delete('format');
            }
            return optimizedUrl.toString();
        } catch (error) {
            console.warn('Failed to build Supabase prompt image transform URL:', error);
        }
    }

    // Return original URL for other images or already-thumbnail URLs
    return url;
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
        return item[localizedKey];
    }

    // Priority 2: Try other language field
    if (item[otherLangKey] && item[otherLangKey].trim()) {
        return item[otherLangKey];
    }

    // Priority 3: Fall back to base field
    return item[field] || '';
}

const PROMPT_MODAL_TAG_GROUP_LIMIT = 12;
const PROMPT_HOT_TAG_LIMIT = 10;
const PROMPT_AI_PAIRED_TAG_FIELDS = Object.freeze(['objects', 'scenes', 'styles', 'mood']);

function getPromptAiTags(item = {}) {
    const aiTags = item?.aiTags || item?.ai_tags;
    return aiTags && typeof aiTags === 'object' ? aiTags : {};
}

function normalizePromptTagText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
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
        pushUniquePromptTag(output, primaryTags[index] || fallbackTags[index], seen);
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

function getPromptContentTagGroupLabels() {
    const isZh = getCurrentLanguage() === 'zh';
    return {
        objects: isZh ? '画面主体' : 'Subjects',
        scenes: isZh ? '场景环境' : 'Scenes',
        styles: isZh ? '视觉风格' : 'Styles',
        mood: isZh ? '情绪氛围' : 'Mood',
        useCase: isZh ? '适用场景' : 'Use cases',
        commercial: isZh ? '商业方向' : 'Commercial',
        difficulty: isZh ? '创作难度' : 'Difficulty'
    };
}

function buildPromptModalContentTagGroups(item = {}) {
    const aiTags = getPromptAiTags(item);
    const labels = getPromptContentTagGroupLabels();
    const groups = [];

    PROMPT_AI_PAIRED_TAG_FIELDS.forEach((field) => {
        const tags = getLocalizedPromptPairedTags(aiTags[field]).slice(0, PROMPT_MODAL_TAG_GROUP_LIMIT);
        if (tags.length > 0) {
            groups.push({ key: field, label: labels[field], tags });
        }
    });

    const useCaseTags = [
        ...getPromptPlainTagList(aiTags.useCase?.platform),
        ...getPromptPlainTagList(aiTags.useCase?.purpose),
        ...getPromptPlainTagList(aiTags.useCase?.format)
    ].slice(0, PROMPT_MODAL_TAG_GROUP_LIMIT);
    if (useCaseTags.length > 0) {
        groups.push({ key: 'useCase', label: labels.useCase, tags: useCaseTags });
    }

    const commercialTags = [
        ...getPromptPlainTagList(aiTags.commercial?.niche),
        ...getPromptPlainTagList(aiTags.commercial?.targetAudience)
    ].slice(0, PROMPT_MODAL_TAG_GROUP_LIMIT);
    if (commercialTags.length > 0) {
        groups.push({ key: 'commercial', label: labels.commercial, tags: commercialTags });
    }

    const difficultyLabel = getPromptDifficultyLabel(aiTags.difficulty);
    if (difficultyLabel) {
        groups.push({ key: 'difficulty', label: labels.difficulty, tags: [difficultyLabel] });
    }

    return groups;
}

function renderPromptModalContentTags(item = {}) {
    const section = document.getElementById('modalContentTagsSection');
    const container = document.getElementById('modalContentTags');
    if (!section || !container) {
        return;
    }

    const groups = buildPromptModalContentTagGroups(item);
    container.replaceChildren();
    const title = section.querySelector('.modal-content-tags-title');
    if (title) {
        title.textContent = getCurrentLanguage() === 'zh' ? '内容标签' : 'Content tags';
    }

    if (groups.length === 0) {
        section.hidden = true;
        return;
    }

    groups.forEach((group) => {
        const groupEl = document.createElement('div');
        groupEl.className = `modal-content-tag-group modal-content-tag-group--${group.key}`;

        const label = document.createElement('div');
        label.className = 'modal-content-tag-label';
        label.textContent = group.label;
        groupEl.appendChild(label);

        const list = document.createElement('div');
        list.className = 'modal-content-tag-list';
        group.tags.forEach((tag) => {
            const chip = document.createElement('span');
            chip.className = 'modal-content-tag-chip';
            chip.textContent = tag;
            list.appendChild(chip);
        });
        groupEl.appendChild(list);
        container.appendChild(groupEl);
    });

    section.hidden = false;
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

function applyPromptsThemeParticleClasses(element, classes, vars = null) {
    if (!element) return;
    const nextClasses = Array.isArray(classes) ? classes : [classes];
    element.className = ['prompts-theme-particle', ...nextClasses.filter(Boolean)].join(' ');
    setPromptsCssVars(element, vars);
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

function setPromptsPercentPosition(element, x, y) {
    if (!element) return;
    setPromptsCssVars(element, {
        left: `${x}%`,
        top: `${y}%`
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

/**
 * Build inverted search index for all searchable content
 * Called once during initialization for O(1) lookups
 */
function buildSearchIndex() {
    // 如果索引已存在且数据量合理，跳过重建
    // 否则重建（处理数据更新后索引过期的情况）
    if (SEARCH_INDEX && Object.keys(SEARCH_INDEX).length > 50) return;
    if (typeof PROMPTS === 'undefined' || PROMPTS.length === 0) return;

    console.log('🔍 Building search index...');
    SEARCH_INDEX = {};

    PROMPTS.forEach((p, id) => {
        if (!p) return;

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
            addToIndex(p.title); // Also index full title
        }

        // Index tags
        if (p.tags) {
            p.tags.forEach(addToIndex);
        }

        // Index AI tags (all categories, both languages)
        // 兼容 aiTags 和 ai_tags 两种字段名
        const aiTags = p.aiTags || p.ai_tags;
        if (aiTags) {
            ['objects', 'scenes', 'styles', 'mood'].forEach(category => {
                const tagData = aiTags[category];
                if (tagData?.en) tagData.en.forEach(addToIndex);
                if (tagData?.zh) tagData.zh.forEach(addToIndex);
            });

            // Index useCase (platform, purpose, format)
            if (aiTags.useCase) {
                if (aiTags.useCase.platform) aiTags.useCase.platform.forEach(addToIndex);
                if (aiTags.useCase.purpose) aiTags.useCase.purpose.forEach(addToIndex);
                if (aiTags.useCase.format) aiTags.useCase.format.forEach(addToIndex);
            }

            // Index commercial (niche, targetAudience)
            if (aiTags.commercial) {
                if (aiTags.commercial.niche) aiTags.commercial.niche.forEach(addToIndex);
                if (aiTags.commercial.targetAudience) aiTags.commercial.targetAudience.forEach(addToIndex);
            }

            // Index difficulty
            if (aiTags.difficulty) addToIndex(aiTags.difficulty);
        }

        // Index dominant colors
        if (p.dominantColors) {
            p.dominantColors.forEach(addToIndex);
        }
    });

    console.log(`✅ Search index built: ${Object.keys(SEARCH_INDEX).length} terms`);
}

/**
 * Fast index-based search (O(1) per term)
 * @param {string} query - Search query
 * @returns {Set<number>} - Set of matching prompt indices
 */
function searchByIndex(query) {
    if (!SEARCH_INDEX) buildSearchIndex();

    const terms = query.toLowerCase().trim().split(/\s+/);
    let results = null;

    terms.forEach(term => {
        // Direct match
        const directMatches = new Set(SEARCH_INDEX[term] || []);

        // Partial match (for terms that are substrings)
        Object.keys(SEARCH_INDEX).forEach(indexedTerm => {
            if (indexedTerm.includes(term) || term.includes(indexedTerm)) {
                SEARCH_INDEX[indexedTerm].forEach(id => directMatches.add(id));
            }
        });

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

// ========================================
// SYSTEM ANNOUNCEMENT (Multi-Type Support)
// ========================================

let currentAnnouncementElement = null;
let announcementOwnsScrollLock = false;
let announcementOverflowRestore = null;

function lockAnnouncementBackground(lockTarget) {
    if (announcementOwnsScrollLock) return;
    if (window.iOSScrollLock?.isLocked) return;

    announcementOwnsScrollLock = true;
    announcementOverflowRestore = getPromptsPageOverflowState();

    setPromptsPageOverflow('hidden');

    if (window.iOSScrollLock) {
        window.iOSScrollLock.lockLight(lockTarget);
    }
}

function unlockAnnouncementBackground() {
    if (!announcementOwnsScrollLock) return;

    if (window.iOSScrollLock?.isLocked) {
        window.iOSScrollLock.unlock();
    }

    if (announcementOverflowRestore) {
        setPromptsPageOverflow(announcementOverflowRestore.htmlOverflow || '');
        setPromptsCssVars(document.body, {
            overflow: announcementOverflowRestore.bodyOverflow || ''
        });
    } else {
        setPromptsPageOverflow('');
    }

    announcementOverflowRestore = null;
    announcementOwnsScrollLock = false;
}

function clearCurrentAnnouncement() {
    stopContinuousParticles();

    if (currentAnnouncementElement) {
        currentAnnouncementElement.remove();
        currentAnnouncementElement = null;
    }

    if (toastBackdropElement) {
        toastBackdropElement.remove();
        toastBackdropElement = null;
    }

    document.body.classList.remove('has-banner');
    unlockAnnouncementBackground();
}

// Get current page ID for announcement targeting
function getCurrentPageId() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('prompts')) return 'prompts';
    if (path.includes('shop')) return 'shop';
    if (path.includes('verify')) return 'verify';
    if (path.includes('guestbook')) return 'guestbook';
    if (path === '/' || path.includes('index') || path.endsWith('/')) return 'index';
    return 'unknown';
}

async function loadAnnouncement() {
    console.log('📢 loadAnnouncement() 开始执行...');

    if (!window.supabaseClient) {
        console.warn('📢 Supabase client 不可用');
        return;
    }

    try {
        console.log('📢 正在获取 notifications 配置...');
        const { data, error } = await window.supabaseClient.rpc('get_system_config', { p_key: 'notifications' });

        if (error) {
            console.error('📢 获取配置出错:', error);
            return;
        }

        if (!data) {
            console.warn('📢 notifications 配置不存在');
            return;
        }

        const config = data;
        console.log('📢 配置:', config);

        // Check if current page is in target pages
        const targetPages = config.announcement_pages || ['all'];
        const currentPage = getCurrentPageId();
        console.log('📢 目标页面:', targetPages, '当前页面:', currentPage);

        if (!targetPages.includes('all') && !targetPages.includes(currentPage)) {
            console.log('📢 当前页面不在公告目标页面中，跳过显示');
            return;
        }

        if (config.announcement_enabled && config.announcement_content) {
            const type = config.announcement_type || 'banner';
            const color = config.announcement_color || 'purple';
            const size = config.announcement_size || 'medium';
            // Convert line breaks to <br> for proper display
            const content = config.announcement_content.replace(/\n/g, '<br>');

            // Check if user already acknowledged this announcement (permanent)
            // Use simple hash of FULL content + timestamp for unique key
            const contentForHash = (config.announcement_content || '') + '|' + (config.announcement_updated_at || '');
            let hash = 0;
            for (let i = 0; i < contentForHash.length; i++) {
                const char = contentForHash.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            const ackKey = 'announcement_acked_' + Math.abs(hash).toString(36);
            console.log('📢 公告标识:', ackKey, '更新时间:', config.announcement_updated_at);
            if (localStorage.getItem(ackKey)) {
                console.log('📢 该公告已被用户确认');
                return;
            }

            // Show announcement based on type
            const decoration = config.announcement_decoration || 'none';
            showAnnouncement(type, color, size, content, ackKey, decoration);
            console.log('公告已显示:', type, color, size, '装饰:', decoration);
        } else {
            console.log('📢 公告未启用或内容为空');
        }
    } catch (err) {
        console.error('📢 加载公告失败:', err);
    }
}

function showAnnouncement(type, color, size, content, ackKey, decoration) {
    // Remove any existing announcement
    if (currentAnnouncementElement) {
        clearCurrentAnnouncement();
    }

    if (type === 'banner') {
        showBannerAnnouncement(color, size, content, ackKey, decoration);
    } else if (type === 'modal') {
        showModalAnnouncement(color, size, content, ackKey, decoration);
    } else if (type === 'toast') {
        showToastAnnouncement(color, size, content, ackKey, decoration);
    }
}

function hydrateDecorationParticleStyles(root) {
    if (!root) return;

    root.querySelectorAll('.dust-mote[data-left]').forEach((mote) => {
        setPromptsCssVars(mote, {
            left: `${mote.dataset.left}%`,
            top: `${mote.dataset.top}%`,
            width: `${mote.dataset.width}px`,
            height: `${mote.dataset.height}px`,
            opacity: mote.dataset.opacity,
            '--tx': `${mote.dataset.tx}px`,
            '--ty': `${mote.dataset.ty}px`,
            'animation-duration': `${mote.dataset.duration}s`,
            'animation-delay': `${mote.dataset.delay}s`
        });
    });

    root.querySelectorAll('.decoration-particle[data-left]').forEach((particle) => {
        const width = particle.dataset.width;
        const height = particle.dataset.height;
        setPromptsCssVars(particle, {
            left: `${particle.dataset.left}%`,
            'animation-delay': `${particle.dataset.delay}s`,
            'animation-duration': `${particle.dataset.duration}s`,
            '--drift-x': `${particle.dataset.drift}px`,
            'font-size': `${particle.dataset.fontSize}px`,
            width: width ? `${width}px` : null,
            height: height ? `${height}px` : null,
            opacity: particle.dataset.opacity,
            filter: `blur(${particle.dataset.blur}px)`
        });
    });
}

// ========================================
// DECORATION PARTICLE SYSTEM
// ========================================

// Generate decoration particles with continuous falling effect
function generateDecorationParticles(theme) {
    if (!theme || theme === 'none') return '';

    // ========================================
    // 特殊装饰：爱心 (Hearts) - 优雅的呼吸光效
    // ========================================
    // ========================================
    // 特殊装饰：阳光 (Sunlight) - 丁达尔效应 + 金色微尘
    // ========================================
    if (theme === 'sunlight' || theme === 'sunshine') {
        let dustParticles = '';
        // Create 50 dust motes
        for (let i = 0; i < 50; i++) {
            const left = Math.random() * 100;
            const top = Math.random() * 100;

            // Precision Tune: 1.0px to 2.6px (Visible but refined)
            const size = 1.0 + Math.random() * 1.6;

            const duration = 20 + Math.random() * 20;
            const delay = Math.random() * -20;
            const opacity = 0.2 + Math.random() * 0.3;

            // Random Trajectory vars
            const tx = Math.random() * 100 - 50; // -50px to +50px drift
            const ty = Math.random() * -70 - 30; // -30px to -100px rise

            dustParticles += `<div class="dust-mote" data-left="${left.toFixed(2)}" data-top="${top.toFixed(2)}" data-width="${size.toFixed(2)}" data-height="${size.toFixed(2)}" data-opacity="${opacity.toFixed(2)}" data-tx="${tx.toFixed(2)}" data-ty="${ty.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-delay="${delay.toFixed(2)}"></div>`;
        }

        return `
            <style>
                /* Theme Variables */
                .decoration-container.sunlight {
                    /* Default (Light Mode) - Soft Gold / Visible Warmth */
                    /* Tuned: More visible than Champagne, but cleaner than Deep Orange */
                    --sun-glow: rgba(255, 200, 120, 0.12);     /* 0.06 -> 0.12 (Visible) */
                    --sun-beam-1-color: 255, 210, 150;         /* Warm Gold */
                    --sun-beam-2-color: 255, 225, 180;         /* Soft Yellow-Gold */
                    --dust-bg: rgba(255, 210, 120, 0.5);       /* More visible dust */
                    --dust-shadow: rgba(255, 200, 100, 0.15);
                    
                    position: absolute;
                    top: 0; left: 0; width: 100%; height: 100%;
                    overflow: hidden;
                    z-index: 0;
                    pointer-events: none;
                    border-radius: inherit;
                    /* Base ambient wash - Theme aware */
                    background: linear-gradient(135deg, var(--sun-glow) 0%, transparent 60%);
                }

                /* Dark Mode Overrides - White/Pale */
                [data-theme="dark"] .decoration-container.sunlight {
                    --sun-glow: rgba(255, 255, 255, 0.05); /* Very subtle white glow */
                    --sun-beam-1-color: 220, 230, 255;      /* Cool white/silver */
                    --sun-beam-2-color: 200, 220, 255;
                    --dust-bg: rgba(255, 255, 255, 0.4);    /* White dust */
                    --dust-shadow: rgba(200, 220, 255, 0.2);
                }
                
                .announcement-header, .announcement-body, .announcement-footer {
                    position: relative;
                    z-index: 10;
                }

                /* 1. Ambient Warmth/Glow */
                .sunlight-glow {
                    position: absolute;
                    top: -25%; left: -25%;
                    width: 120%; height: 120%;
                    background: radial-gradient(circle at 25% 25%, var(--sun-glow) 0%, transparent 60%);
                    animation: sunPulse 10s ease-in-out infinite alternate;
                }

                /* 2. God Rays Base (Shared) */
                .sunlight-beam {
                    position: absolute;
                    top: -50%; left: -50%;
                    width: 200%; height: 200%;
                    filter: blur(3px); 
                    transform-origin: 40% 40%;
                    will-change: transform, opacity;
                }

                /* Layer 1: The "Hero" Rays */
                .sunlight-beam.layer-1 {
                    background: linear-gradient(
                        115deg,
                        transparent 25%,
                        rgba(var(--sun-beam-1-color), 0.15) 30%, 
                        transparent 35%, 
                        rgba(var(--sun-beam-1-color), 0.25) 45%, 
                        transparent 50%,
                        rgba(var(--sun-beam-1-color), 0.1) 60%, 
                        transparent 70%
                    );
                    background-size: 150% 150%;
                    animation: sunRayPrimary 18s ease-in-out infinite alternate; 
                }

                /* Layer 2: The "Fill" */
                .sunlight-beam.layer-2 {
                    background: linear-gradient(
                        110deg,
                        transparent 20%,
                        rgba(var(--sun-beam-2-color), 0.08) 40%, 
                        transparent 60%,
                        rgba(var(--sun-beam-2-color), 0.1) 75%,
                        transparent 90%
                    );
                    background-size: 150% 150%;
                    opacity: 0.7;
                    animation: sunRaySecondary 22s ease-in-out infinite alternate-reverse; 
                }

                /* 3. Dust Motes - Theme Aware */
                .dust-mote {
                    position: absolute;
                    background: var(--dust-bg);
                    box-shadow: 0 0 1px var(--dust-shadow);
                    border-radius: 50%;
                    animation-name: dustFloat;
                    animation-timing-function: ease-in-out;
                    animation-iteration-count: infinite;
                    will-change: transform, opacity;
                }

                @keyframes sunPulse {
                    0% { opacity: 0.8; transform: scale(1); }
                    100% { opacity: 1; transform: scale(1.05); }
                }

                @keyframes sunRayPrimary {
                    0% { 
                        transform: rotate(0deg) translateX(0); 
                        opacity: 0.8; 
                        background-position: 0% 50%;
                    }
                    100% { 
                        transform: rotate(3deg) translateX(10px); 
                        opacity: 1; 
                        background-position: 20% 50%; /* Increased flow range slightly */
                    }
                }

                @keyframes sunRaySecondary {
                    0% { 
                        transform: rotate(-2deg) translateX(-5px); 
                        opacity: 0.4; 
                        background-position: 10% 50%;
                    }
                    100% { 
                        transform: rotate(1deg) translateX(5px); 
                        opacity: 0.6; 
                        background-position: 0% 50%;
                    }
                }
                
                @keyframes dustFloat {
                    0% { transform: translate(0, 0); opacity: 0; }
                    20% { opacity: 1; }
                    70% { opacity: 1; } /* Disappear earlier randomly */
                    100% { 
                        transform: translate(var(--tx), var(--ty)); /* Random Trajectory */
                        opacity: 0; 
                    }
                }
            </style>

            <div class="decoration-container sunlight">
                 <div class="sunlight-glow"></div>
                 <div class="sunlight-beam layer-1"></div>
                 <div class="sunlight-beam layer-2"></div>
                 ${dustParticles}
            </div>
        `;
    }

    if (theme === 'hearts') {
        return `
                <style>
                    .decoration-pulsing-bg {
                        position: absolute;
                        top: 0; left: 0; width: 100%; height: 100%;
                        overflow: hidden;
                        z-index: 1;
                        pointer-events: none;
                        border-radius: inherit;
                    }
                    /* Ensure content sits above */
                    .announcement-header, .announcement-body, .announcement-footer {
                        position: relative;
                        z-index: 2;
                    }
                    
                    /* Container handles Position + Floating (Bobbing) */
                    .heart-container {
                        position: absolute;
                        will-change: top, left, opacity;
                        transition: opacity 2s ease-in-out; /* Slower fade */
                    }
                    .heart-container.relocating {
                        opacity: 0 !important;
                    }

                    /* Inner SVG handles Pulse + Shape */
                    .heart-svg {
                        width: 100%; height: 100%;
                        filter: blur(16px); /* Increased blur (was 8px) */
                        fill: currentColor;
                        display: block;
                        /* Animation defined in modifiers below */
                    }

                    /* --- Heart 2 (Big) --- */
                    .container-2 {
                        width: 240px; height: 240px; /* Reduced from 320px */
                        top: 20%; left: 20%; /* Initial pos */
                        color: rgba(255, 120, 160, 0.5); 
                        animation: gentleFloat 8s ease-in-out infinite;
                    }
                    .container-2 .heart-svg {
                        animation: realHeartBeat 8s ease-in-out infinite; /* Main beat */
                    }

                    /* --- Heart 3 (Small) --- */
                    .container-3 {
                        width: 160px; height: 160px;
                        top: 60%; left: 70%; /* Initial pos far from Heart 2 */
                        color: rgba(255, 140, 180, 0.6); 
                        animation: gentleFloat 6s ease-in-out infinite reverse; 
                    }
                    .container-3 .heart-svg {
                        filter: blur(24px); /* Very blurry (was 12px) */
                        animation: realHeartBeat 8s ease-in-out infinite;
                        animation-delay: 2s; /* Echo beat (2s after main) */
                    }

                    @keyframes realHeartBeat {
                        /* "Lub-Dub" takes ~20% of 8s (1.6s), rest is silence */
                        0%   { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                        5%   { transform: scale(1.08) rotate(0deg); opacity: 0.7; } /* Lub */
                        10%  { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                        15%  { transform: scale(1.12) rotate(3deg); opacity: 0.8; } /* Dub */
                        20%  { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                        100% { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                    }

                    @keyframes gentleFloat {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(-20px); }
                    }
                </style>
                
                <!-- Heart 2 -->
                <div class="heart-container container-2">
                    <svg class="heart-svg" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </div>

                <!-- Heart 3 -->
                <div class="heart-container container-3">
                    <svg class="heart-svg" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </div>
        `;
    }

    const themeEmoji = {
        snow: '❄️', sakura: '🌸', fireworks: '✨', // hearts removed from here effectively
        leaves: '🍂', rain: '💧', sunshine: '☀️'
    };

    // 增加粒子数量确保持续下落 (Optimized for continuous flow & density)
    const particleCounts = {
        snow: 24, sakura: 24, fireworks: 15, hearts: 12,
        leaves: 12, rain: 30, sunshine: 5 // Sakura: 20 -> 24 for better flow
    };

    // Helper to generate random leaf SVG
    const getLeafContent = () => {
        const type = Math.floor(Math.random() * 3);
        const colors = ['#e06c75', '#d19a66', '#e5c07b', '#c678dd', '#be5046']; // Autumn Palette
        const color = colors[Math.floor(Math.random() * colors.length)];

        // 1. Maple Leaf (Maple)
        if (type === 0) {
            return `<svg viewBox="0 0 24 24" fill="${color}" class="decoration-svg"><path d="M12.5,2C12.5,2 12.8,4.5 11,6C9,7.5 7,6 7,6L6,8C6,8 3,7.5 2,9C1,10.5 4,11 4,11L3,13C3,13 1,12.5 0,14C-1,15.5 2,16 2,16L3,18C3,18 2,19.5 4,20.5C6,21.5 7,19.5 7,19.5L9,21C9,21 10,22 13,22C16,22 16,19 16,19L17,20.5C17,20.5 19,20.5 20,19C21,17.5 19,16 19,16L21,14.5C21,14.5 23,14 22,12C21,10 19,10.5 19,10.5L20,8C20,8 19,6 17,6C15,6 14.5,8 14.5,8L12.5,2Z" /></svg>`;
        }
        // 2. Oak Leaf (Oak - Lobed)
        if (type === 1) {
            return `<svg viewBox="0 0 24 24" fill="${color}" class="decoration-svg"><path d="M7,18C6,18 5,16.5 5.5,15C6,13.5 4,12 4,12C4,12 5,10.5 6.5,11C8,11.5 9,10 9,10C9,10 8,8 9.5,7C11,6 12,3 13,3C14,3 15.5,5 15,7C14.5,9 16,9.5 16,9.5C16,9.5 18,9 18.5,10.5C19,12 17,13 17,13C17,13 18.5,14 18,16C17.5,18 16,18 15,17C14,16 13,17 12,18C11,19 12,21 12,21H11C11,21 10,19 11,18C12,17 10,16 10,16C10,16 8,18 7,18Z"/></svg>`;
        }
        // 3. Poplar/Birch (Simple Teardrop)
        return `<svg viewBox="0 0 24 24" fill="${color}" class="decoration-svg"><path d="M12,2C12,2 4,8 4,14C4,19 9,22 12,22C15,22 20,19 20,14C20,8 12,2 12,2M12,20C12,20 11,16 12,12"/></svg>`;
    };

    // Helper to generate random Sakura SVG
    const getSakuraContent = () => {
        const type = Math.random(); // Use float for probability
        const colors = ['#fecdd3', '#fca5a5', '#fda4af', '#f43f5e']; // Premium Pink Palette
        const color = colors[Math.floor(Math.random() * colors.length)];

        // 60% Full Flower (5 Petals with authentic notches)
        if (type > 0.4) {
            // A more detailed 5-petal sakura shape
            return `<svg viewBox="0 0 100 100" fill="${color}" class="decoration-svg"><path d="M50 50 L50 15 C50 15 55 20 60 15 C65 10 75 25 50 50 Z M50 50 L85 50 C85 50 80 55 85 60 C90 65 75 75 50 50 Z M50 50 L50 85 C50 85 45 80 40 85 C35 90 25 75 50 50 Z M50 50 L15 50 C15 50 20 45 15 40 C10 35 25 25 50 50 Z M50 50 L25 25 C25 25 30 20 25 15 C20 10 10 20 50 50 Z" stroke="none" opacity="0.9"/><circle cx="50" cy="50" r="4" fill="#fff1f2"/></svg>`;
        }

        // 40% Single Petal (Notched tip, not heart)
        // Classic Sakura petal shape: wider top with a notch, tapering bottom
        return `<svg viewBox="0 0 100 100" fill="${color}" class="decoration-svg"><path d="M50 90 C50 90 20 60 20 40 C20 25 30 10 45 20 C48 22 50 25 50 25 C50 25 52 22 55 20 C70 10 80 25 80 40 C80 60 50 90 50 90 Z" opacity="0.8"/></svg>`;
    };


    const count = particleCounts[theme] || 20;
    let particles = '';

    // Helper to generate random Snowflake SVG (Theme Adaptive)
    const getSnowContent = () => {
        // High-quality Snowflake SVG
        return `<svg viewBox="0 0 24 24" fill="var(--snow-color)" class="decoration-svg"><path d="M12,2L12,22 M2,12L22,12 M19.07,4.93L4.93,19.07 M19.07,19.07L4.93,4.93 M12,2C12,2 14,6 16,6 M12,2C12,2 10,6 8,6 M12,22C12,22 14,18 16,18 M12,22C12,22 10,18 8,18 M2,12C2,12 6,10 6,8 M2,12C2,12 6,14 6,16 M22,12C22,12 18,10 18,8 M22,12C22,12 18,14 18,16" stroke="var(--snow-color)" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;
    };

    for (let i = 0; i < count; i++) {
        // Select content - Move inside loop for diversity
        let particleContent = '';
        if (theme === 'leaves') {
            particleContent = getLeafContent();
        } else if (theme === 'sakura') {
            particleContent = getSakuraContent();
        } else if (theme === 'snow') {
            particleContent = getSnowContent();
        } else {
            particleContent = theme === 'sunshine' ? '' : // Sunshine is css-only
                theme === 'rain' ? '' : // Rain uses JS canvas/physics (streaks) only
                    theme === 'fireworks' ? '' : // Fireworks uses JS canvas/physics only
                        '❤️';
        }

        const left = Math.random() * 100;
        // Depth Logic: 0.0 (Far) -> 1.0 (Near)
        const depth = Math.random();
        // Re-coupled speed to depth for true 3D effect.
        // Near (1.0) = Fast (e.g. 10s), Far (0.0) = Slow (e.g. 25s)
        // We keep some random noise (+/- 2s) to avoid robotic feel, but preserve the trend.
        const baseDuration = theme === 'rain' ? 2 : theme === 'snow' ? 15 : 12;
        const depthFactor = theme === 'rain' ? 3 : 10; // Rain varies less
        const duration = baseDuration + ((1 - depth) * depthFactor) + (Math.random() * 4 - 2);

        const delay = -Math.random() * duration;

        // Size: Near = Bigger (1.2), Far = Smaller (0.3)
        // Wider range for more dramatic contrast
        const size = 0.3 + (depth * 0.9);

        const driftOffset = Math.random() * 80 - 40;
        // Font Size Config
        const fontSize = theme === 'sunshine' ? 18 + Math.random() * 6 :
            theme === 'rain' ? 8 + Math.random() * 4 :
                theme === 'leaves' ? 14 + Math.random() * 8 :
                    theme === 'sakura' ? 16 + Math.random() * 6 : /* SVG Sakura Size: 16-22px base */
                        theme === 'snow' ? 8 + Math.random() * 4 : /* Micro Snow: 8-12px base */
                            12 + Math.random() * 6;

        const finalFontSize = fontSize * size;

        // Explicit dimensions for SVGs (Added snow via SVG)
        const dimensionSize = (theme === 'leaves' || theme === 'sakura' || theme === 'snow')
            ? finalFontSize.toFixed(0)
            : '';

        // Opacity: Near = 1.0, Far = 0.4 (Increased visibility floor)
        const opacity = 0.4 + (depth * 0.6);

        // Blur: Far = 1.5px, Near = 0px (Sharper for visibility)
        const blur = (1 - depth) * 1.5;

        particles += `<span class="decoration-particle" data-left="${left.toFixed(2)}" data-delay="${delay.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-drift="${driftOffset.toFixed(2)}" data-font-size="${finalFontSize.toFixed(0)}" data-width="${dimensionSize}" data-height="${dimensionSize}" data-opacity="${opacity.toFixed(2)}" data-blur="${blur.toFixed(1)}">${particleContent}</span>`;
    }

    return `<div class="decoration-particles ${theme}">${particles}</div>`;
}

// 活跃的粒子动画控制器
const ParticleSystem = {
    timer: null,
    frameId: null,
    particles: [],
    container: null,
    theme: null,
    width: 0,
    height: 0,
    lastTime: 0,

    init(container, theme) {
        this.stop(); // 清理旧的
        if (!container || !theme || theme === 'none') return;

        this.container = container;
        this.theme = theme;
        this.particles = [];

        // 强制容器样式，确保动画环境稳定
        container.classList.add('prompts-theme-particle-layer');

        // 更新尺寸
        this.updateDimensions();

        // 立即生成一批 (Pre-warm)，让画面一开始就有内容飘落
        // 雨雪天气增加预热数量
        let initialCount = 6;
        if (theme === 'rain' || theme === 'snow') initialCount = 40;

        this.spawnBatch(initialCount, true);

        // 启动循环
        // 启动循环 (必须通过 rAF 传入 timestamp，否则 deltaTime 为 NaN)
        this.frameId = requestAnimationFrame((t) => this.loop(t));

        // 定时生成
        this.scheduleSpawn();
    },

    stop() {
        if (this.timer) clearTimeout(this.timer);
        if (this.frameId) cancelAnimationFrame(this.frameId);
        if (this.container) {
            this.container.innerHTML = ''; // 清空DOM
        }
        this.particles = [];
        this.timer = null;
        this.frameId = null;
        this.container = null;
    },

    updateDimensions() {
        if (!this.container) return;
        this.width = this.container.clientWidth || 0;
        this.height = this.container.clientHeight || 0;

        // 获取按钮的碰撞体积
        const btn = this.container.parentElement ? this.container.parentElement.querySelector('.announcement-ack-btn') : null;
        if (btn) {
            const parentRect = this.container.getBoundingClientRect();
            const btnRect = btn.getBoundingClientRect();
            this.btnBounds = {
                top: btnRect.top - parentRect.top,
                left: btnRect.left - parentRect.left,
                right: btnRect.right - parentRect.left,
                bottom: btnRect.bottom - parentRect.top
            };
        } else {
            this.btnBounds = null;
        }
    },

    getParticleContent() {
        if (this.theme === 'sakura') {
            // 原创手绘樱花矢量图 (SVG)
            // 包含花蕊细节和渐变色
            return `
            <svg viewBox="0 0 32 32" width="100%" height="100%" class="decoration-svg decoration-svg--overflow-visible">
                <defs>
                    <radialGradient id="sakuraGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                        <stop offset="0%" stop-color="#ffe6ea" stop-opacity="1" />
                        <stop offset="100%" stop-color="#ffb7b2" stop-opacity="1" />
                    </radialGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="1" result="blur"/>
                        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                    </filter>
                </defs>
                <!-- 花瓣主体 -->
                <path d="M16 2 C16 2 9 8 9 14 C9 21 16 28 16 28 C16 28 23 21 23 14 C23 8 16 2 16 2 Z" 
                      fill="url(#sakuraGradient)" stroke="#ff9e99" stroke-width="0.5" />
                <!-- 内部花蕊细节 -->
                <path d="M16 28 Q13 20 16 12 Q19 20 16 28" fill="none" stroke="#fff" stroke-width="0.8" opacity="0.6"/>
            </svg>`;
        }

        if (this.theme === 'snow') {
            // 原创矢量雪花 (SVG) - 简化版 (无 Gradient/Filter，确保颜色正确)
            return `
            <svg viewBox="0 0 32 32" width="100%" height="100%" class="decoration-svg decoration-svg--overflow-visible">
                <g stroke="var(--snow-color)" stroke-width="1.5" stroke-linecap="round" fill="none">
                    <!-- 主轴 -->
                    <path d="M16 2 L16 30 M8 6 L24 26 M24 6 L8 26" />
                    <!-- 枝晶细节 -->
                    <path d="M16 6 L13 9 M16 6 L19 9" />
                    <path d="M16 26 L13 23 M16 26 L19 23" />
                    <path d="M22 9 L20 12 M22 9 L23 12" />
                    <path d="M10 23 L12 20 M10 23 L9 20" />
                    <path d="M22 23 L20 20 M22 23 L23 20" />
                    <path d="M10 9 L12 12 M10 9 L9 12" />
                </g>
                <!-- 中心晶核 - 直接填充颜色，无 Gradient -->
                <circle cx="16" cy="16" r="2.5" fill="var(--snow-color)" opacity="0.8" />
            </svg>`;
        }

        // 其他主题暂时保持 Emoji
        const themeEmoji = {
            fireworks: '✨', hearts: '❤️',
            leaves: '🍂', sunshine: '☀️',
            // 雨滴改为 SVG，此处留空或返回特定标记
            rain: '<svg viewBox="0 0 10 20" width="100%" height="100%"><path d="M5 0 Q 5 10 0 15 A 5 5 0 1 0 10 15 Q 5 10 5 0" fill="rgba(173, 216, 230, 0.6)"/></svg>'
        };
        return themeEmoji[this.theme] || '🌸';
    },

    // 烟花爆炸逻辑
    explode(rocket) {
        const type = rocket.subType || 'willow'; // 默认柳叶型

        // 1. 柳叶 (Willow): 金/银色，下落慢，悬浮感强
        if (type === 'willow') {
            const sparkCount = 30 + Math.random() * 20;
            for (let i = 0; i < sparkCount; i++) {
                this.createSpark(rocket, {
                    speed: 1 + Math.random() * 3,
                    gravity: 0.02 + Math.random() * 0.02,
                    friction: 0.97,
                    decay: 0.002 + Math.random() * 0.003,
                    color: Math.random() > 0.5 ? '#FFD700' : '#E0E0E0' // 金银
                });
            }
        }
        // 2. 牡丹 (Peony): 彩色，球形均匀，炸得更开
        else if (type === 'peony') {
            const sparkCount = 40 + Math.random() * 20;
            const baseHue = Math.random() * 360; // 统一色系
            for (let i = 0; i < sparkCount; i++) {
                this.createSpark(rocket, {
                    speed: 2 + Math.random() * 4, // 初始速度快
                    gravity: 0.03 + Math.random() * 0.02,
                    friction: 0.95, // 阻力稍大，停得快
                    decay: 0.005 + Math.random() * 0.005, // 消失稍快
                    color: `hsl(${baseHue + Math.random() * 40}, 100%, 70%)`
                });
            }
        }
        // 3. 光环 (Ring): 只有边缘有粒子
        else if (type === 'ring') {
            const sparkCount = 36; // 均匀分布
            const ringSpeed = 3 + Math.random() * 1;
            const color = `hsl(${Math.random() * 360}, 100%, 75%)`;
            for (let i = 0; i < sparkCount; i++) {
                const angle = (i / sparkCount) * Math.PI * 2;
                this.createSpark(rocket, {
                    vx: Math.cos(angle) * ringSpeed,
                    vy: Math.sin(angle) * ringSpeed,
                    gravity: 0.025,
                    friction: 0.98, // 阻力小，保持圆环形状扩散
                    decay: 0.003 + Math.random() * 0.003,
                    color: color,
                    fixedSpeed: true // 标记使用自定义vx/vy
                });
            }
        }
    },

    createSpark(rocket, CONFIG) {
        const el = document.createElement('div');
        applyPromptsThemeParticleClasses(el, 'prompts-theme-particle--spark', {
            '--particle-color': CONFIG.color
        });

        this.container.appendChild(el);

        const angle = Math.random() * Math.PI * 2;
        const speed = CONFIG.speed || (1 + Math.random() * 3);

        this.particles.push({
            el: el,
            type: 'spark',
            x: rocket.x,
            y: rocket.y,
            // 如果传入 fixedSpeed 则忽略随机角度计算
            vx: CONFIG.fixedSpeed ? CONFIG.vx : Math.cos(angle) * speed,
            vy: CONFIG.fixedSpeed ? CONFIG.vy : Math.sin(angle) * speed,
            gravity: CONFIG.gravity,
            friction: CONFIG.friction,
            opacity: 1,
            decay: CONFIG.decay,
            state: 'fading'
        });
    },


    spawnBatch(count, preWarm = false) {
        for (let i = 0; i < count; i++) {
            let startY;
            if (preWarm && this.height > 0) {
                // 预热：随机分布在整个屏幕高度 (包含负值以便衔接)
                startY = Math.random() * (this.height + 50) - 50;
            } else {
                // 正常：从顶部上方生成
                startY = -20 - Math.random() * 50;
            }
            // 稍微错开位置
            this.createParticle(startY);
        }
    },

    scheduleSpawn() {
        // 默认为普通模式
        let delay = 1800 + Math.random() * 1200;
        let maxParticles = 12;

        // 雨天模式：极速高密度
        if (this.theme === 'rain') {
            delay = 30 + Math.random() * 30; // 30-60ms 极快
            maxParticles = 80; // 允许同屏 80 个雨滴
        }


        // 雪天模式：中等密度，允许堆积
        else if (this.theme === 'snow') {
            delay = 200 + Math.random() * 200; // 200-400ms
            maxParticles = 60; // 允许较多雪花共存(含堆积)
        }

        this.timer = setTimeout(() => {
            if (this.container && this.particles.length < maxParticles) {

                // 烟花连发逻辑：8% 概率触发连发 (降低概率)
                if (this.theme === 'fireworks' && Math.random() < 0.08) {
                    this.fireCombo();
                } else {
                    this.createParticle();
                }
            }
            this.scheduleSpawn();
        }, delay);
    },

    // 烟花连发
    fireCombo() {
        const count = 2 + Math.floor(Math.random() * 2); // 2-3个
        for (let i = 0; i < count; i++) {
            // 稍微错开时间发射，模拟真实烟花的 "嘭-嘭-嘭"
            setTimeout(() => {
                this.createParticle();
            }, i * 300 + Math.random() * 200);
        }
    },

    createParticle(startY = -30) {
        if (!this.container) return;

        // --- 烟花逻辑分支 ---
        if (this.theme === 'fireworks') {
            const el = document.createElement('div');
            el.textContent = '✦'; // 烟花弹
            const rocketColor = `hsl(${Math.random() * 360}, 100%, 70%)`;
            applyPromptsThemeParticleClasses(el, 'prompts-theme-particle--rocket', {
                '--particle-color': rocketColor
            });

            this.container.appendChild(el);

            const p = {
                el: el,
                type: 'rocket', // 类型标记
                subType: ['willow', 'peony', 'ring'][Math.floor(Math.random() * 3)], // 随机类型
                x: 20 + Math.random() * (this.width - 40), // 随机X位置
                y: this.height, // 从底部发射
                targetY: this.height * 0.05 + Math.random() * (this.height * 0.2), // 目标高度：顶部 5%-25% 处 (更高)
                vx: (Math.random() - 0.5) * 1, // 轻微左右偏移
                vy: -4 - Math.random() * 3, // 向上速度 (稍微加快)
                state: 'rising',
                opacity: 1,
                color: rocketColor
            };
            this.particles.push(p);
            return;
        }

        // 防止宽度过小（弹窗动画初期）时堆积
        // 只有当宽度确实 > 100 时才开始生成，彻底杜绝边缘堆积
        if (!this.width || this.width < 100) return;

        // --- 雨滴逻辑分支 (CSS Streaks) ---
        if (this.theme === 'rain') {
            const el = document.createElement('div');
            applyPromptsThemeParticleClasses(el, 'prompts-theme-particle--rain', {
                '--particle-width': `${1 + Math.random()}px`,
                '--particle-height': `${60 + Math.random() * 60}px`,
                '--particle-opacity': (0.4 + Math.random() * 0.4).toFixed(2)
            });

            this.container.appendChild(el);

            const p = {
                el: el,
                type: 'rain',
                // 左右留边 20px，防止贴边显示不全; 确保 range >= 0
                x: 20 + Math.random() * Math.max(0, this.width - 40),
                y: -150, // 从更上方开始，保证进入画面时已有速度感
                speed: 25 + Math.random() * 15, // 极速狂飙 (25-40px/frame)
                swayAmp: 0,
                swaySpeed: 0,
                rotation: 5 + Math.random() * 5, // 轻微倾斜 (5-10度)
                rotSpeed: 0,
                state: 'falling',
                targetAmp: 0,
                landingY: this.height
            };
            this.particles.push(p);
            return;
        }

        // --- 雪花逻辑分支 (复用SVG但自定义物理) ---
        // 放在通用逻辑前拦截
        if (this.theme === 'snow') {
            // 1. 创建元素
            const el = document.createElement('div');

            // 引入更丰富的多样性 (3个层级)
            const rand = Math.random();
            let size, isCrystal = false;
            let swayParam = 1.0; // 物理参数系数
            const particleClasses = ['prompts-theme-particle--snow'];

            // 层级 1: 微尘 (30%) - 极小，增加氛围感
            if (rand < 0.3) {
                size = 1.5 + Math.random() * 1.5; // 1.5-3px (极小)
                particleClasses.push('prompts-theme-particle--snow-dust');
                swayParam = 1.5; // 更容易受风影响，摇摆快
            }
            // 层级 2: 柔光片 (20%) - 中等，模糊边缘
            else if (rand < 0.5) {
                size = 3 + Math.random() * 2; // 3-5px (缩小)
                particleClasses.push('prompts-theme-particle--snow-soft');
                swayParam = 1.2;
            }
            // 层级 3: 冰晶 (20%) - 大，清晰 SVG
            else {
                isCrystal = true;
                el.innerHTML = this.getParticleContent().trim();
                size = 4 + Math.random() * 4; // 4-8px (极致精细)
                particleClasses.push('prompts-theme-particle--snow-crystal');
                swayParam = 0.8; // 重，摇摆稳
            }

            applyPromptsThemeParticleClasses(el, particleClasses, {
                '--particle-size': `${size}px`
            });

            this.container.appendChild(el);

            // 2. 堆积逻辑
            // 统计当前已堆积(resting)的雪花数量
            const restingCount = this.particles.filter(p => p.state === 'resting').length;
            // 允许最多 35 个像自然积雪一样停留在底部
            const willRest = restingCount < 35;

            // 3. 物理属性
            const p = {
                el: el,
                type: 'snow', // 标记类型
                startX: Math.random() * this.width,
                currentX: 0,
                y: startY, // -30
                // 飘落极其缓慢
                speed: (0.4 + Math.random() * 0.6) * (2 - swayParam), // 小颗粒(sway large)飘得慢，大颗粒(sway small)飘得稍快
                // 大幅度摇摆 (Drift)
                swayAmp: (10 + Math.random() * 20) * swayParam, // 10-30px 摆幅 (减小)
                swaySpeed: (0.002 + Math.random() * 0.006) * swayParam, // 摇摆更缓慢
                phase: Math.random() * Math.PI * 2,

                rotation: Math.random() * 360,
                // 只有晶体才旋转，尘埃不明显旋转
                rotSpeed: isCrystal ? (Math.random() - 0.5) * 1.5 : 0,

                state: 'falling',
                opacity: 0,
                size: size,
                // 落地位置：带一点随机起伏，模拟不平整雪堆
                landingY: this.height - size * 0.8 - (Math.random() * 8),
                willRest: willRest,
                restTime: 0
            };
            // 初始X需计算一次
            p.currentX = p.startX + Math.sin(p.phase) * p.swayAmp;

            this.particles.push(p);
            return;
        }

        // --- 原有逻辑 (花瓣/其他) ---
        const el = document.createElement('div');
        // 使用 innerHTML 插入 SVG
        // 关键修复：去除首尾空格，否则 startsWith('<svg') 会失败导致显示源码
        const content = this.getParticleContent().trim();

        // 计算精确尺寸 (再大一点)
        const size = 26 + Math.random() * 12; // 26-38px

        if (content.startsWith('<svg')) {
            el.innerHTML = content;
            applyPromptsThemeParticleClasses(el, ['prompts-theme-particle--decor', 'prompts-theme-particle--decor-svg'], {
                '--particle-size': `${size}px`
            });
        } else {
            el.textContent = content;
            applyPromptsThemeParticleClasses(el, ['prompts-theme-particle--decor', 'prompts-theme-particle--decor-emoji'], {
                '--particle-size': `${size}px`
            });
        }

        this.container.appendChild(el);

        // 动态决定是否停留：用户希望始终保持 2-3 个
        const restingCount = this.particles.filter(p => p.state === 'resting').length;
        let willRest = false;

        // 只有当极度稀缺(<1)时才小概率补充，否则绝对不停
        if (restingCount < 1) {
            willRest = Math.random() < 0.2; // 只有 20% 概率补充第一个
        } else {
            // willRest = false; // logic removed
        }

        // 所有的雪花都应该堆积 (100% 堆积率)
        if (this.theme === 'snow') {
            willRest = true;
        }

        const p = {
            el: el,
            startX: Math.random() * this.width, // 初始X轴中心
            currentX: 0,
            y: startY,
            // 物理属性
            speed: 0.5 + Math.random() * 0.4,
            swayAmp: 10 + Math.random() * 20,
            targetAmp: 0,
            // 降低摇曳频率，更加慵懒
            swaySpeed: 0.003 + Math.random() * 0.008,
            phase: Math.random() * Math.PI * 2,
            rotation: Math.random() * 360,
            // 随机旋转方向：正负随机
            // 只有 60% 的粒子会旋转，40% 的粒子保持静止角度飘落
            rotSpeed: (Math.random() > 0.4)
                ? (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.5)
                : 0,

            // 状态
            // 状态
            state: 'falling',
            opacity: 0,
            restTime: 0,
            size: size,
            isCrystal: isCrystal, // 保存类型用于物理计算
            willRest: willRest
        };

        // 设定落地后的目标摇摆幅度 (停留时仅微风吹动)
        // 设定落地后的目标摇摆幅度 (停留时停止摇摆)
        p.targetAmp = 0;
        // 随机微调落地高度，模拟积雪不平整 (-2px 到 +2px)
        p.landingOffset = (Math.random() - 0.5) * 4;

        this.particles.push(p);
    },

    createSplash(x, y) {
        const splashCount = 3 + Math.floor(Math.random() * 4); // 3-6 个水滴
        for (let i = 0; i < splashCount; i++) {
            const el = document.createElement('div');
            applyPromptsThemeParticleClasses(el, 'prompts-theme-particle--splash');
            // 修正：初始位置
            setPromptsCssVars(el, {
                transform: `translate3d(${x}px, ${y}px, 0)`
            });

            this.container.appendChild(el);

            this.particles.push({
                el: el,
                type: 'splash',
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 4, // 向左右溅射
                vy: -3 - Math.random() * 3, // 向上溅起
                friction: 0.95,
                gravity: 0.5, // 重力较大，快速落下
                opacity: 1,
                state: 'fading'
            });
        }
    },

    loop(timestamp) {
        if (!this.container) return;

        // 保底：如果没有传入 timestamp (比如手动调用)，使用 perf.now
        if (!timestamp) timestamp = performance.now();

        // 初始化或长时间暂停后重置
        if (!this.lastTime) this.lastTime = timestamp;
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        // 限制最大帧间隔 (防止切后台回来后瞬间爆炸)
        // 16.67ms = 60fps. timeScale = 1.0 @ 60fps
        const timeScale = Math.min(deltaTime, 100) / 16.67;

        this.updateDimensions();

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];

            // --- 烟花物理逻辑: 火箭 ---
            if (p.type === 'rocket') {
                p.y += p.vy * timeScale;
                setPromptsCssVars(p.el, {
                    transform: `translate3d(${p.x}px, ${p.y}px, 0)`
                });

                // 到达目标高度或速度耗尽则爆炸
                if (p.y <= p.targetY) {
                    this.explode(p);
                    this.particles.splice(i, 1);
                    p.el.remove();
                }
                continue;
            }

            // --- 烟花物理逻辑: 雨滴 ---
            if (p.type === 'rain') {
                // 高刷屏下(>100Hz, deltaTime < 10ms)，极速流体看起来会比 60Hz 视觉上更快 (无残影)。
                // 增加感知补偿系数：如果是高刷，降低速度以匹配 60Hz 的观感。
                let hzDampener = 1.0;
                if (deltaTime < 10) hzDampener = 0.6; // 240Hz 降速 40%

                p.y += p.speed * timeScale * hzDampener;
                setPromptsCssVars(p.el, {
                    transform: `translate3d(${p.x}px, ${p.y}px, 0)`
                });
                // 边界检测：超出屏幕底部移除
                if (p.y > this.height) {
                    // 溅起水花
                    this.createSplash(p.x, this.height);

                    this.particles.splice(i, 1);
                    p.el.remove();
                }
                continue;
            }

            // --- 烟花物理逻辑: 溅起的水花 ---
            if (p.type === 'splash') {
                p.vy += 0.5 * timeScale; // 重力
                p.x += p.vx * timeScale;
                p.y += p.vy * timeScale;
                p.opacity -= 0.05 * timeScale; // 快速消失

                setPromptsCssVars(p.el, {
                    opacity: String(p.opacity),
                    transform: `translate3d(${p.x}px, ${p.y}px, 0)`
                });

                if (p.opacity <= 0) {
                    this.particles.splice(i, 1);
                    p.el.remove();
                }
                continue;
            }

            // --- 烟花物理逻辑: 火花 ---
            if (p.type === 'spark') {
                // 摩擦力指数衰减: vel = vel * friction^timeScale
                p.vx *= Math.pow(p.friction, timeScale);
                p.vy *= Math.pow(p.friction, timeScale);
                p.vy += p.gravity * timeScale;
                p.x += p.vx * timeScale;
                p.y += p.vy * timeScale;
                p.opacity -= p.decay * timeScale;

                setPromptsCssVars(p.el, {
                    opacity: String(p.opacity),
                    transform: `translate3d(${p.x}px, ${p.y}px, 0)`
                });

                if (p.opacity <= 0) {
                    this.particles.splice(i, 1);
                    p.el.remove();
                }
                continue;
            }

            // 动态更新 landingY 以适应窗口大小变化
            // 差异化落地高度：
            // 1. 晶体 (SVG): 沉入 20% (HEIGHT - size*0.2)，看起来"脚踏实地"
            // 2. 圆点 (Dust/Soft): 沉入 50% (HEIGHT - size*0.5)，看起来"嵌入/半埋"在雪堆里
            const sinkRatio = p.isCrystal ? 0.2 : 0.5;
            let currentLandingY = this.height - p.size * sinkRatio + (p.landingOffset || 0);

            // 检测按钮碰撞
            if (this.btnBounds && p.currentX >= this.btnBounds.left && p.currentX <= this.btnBounds.right) {
                // 同样应用差异化沉入
                // 晶体沉入少一点 (0.3)，圆点沉入多一点 (0.6)
                const btnSinkRatio = p.isCrystal ? 0.3 : 0.6;
                const btnY = this.btnBounds.top - p.size * btnSinkRatio + 2;
                if (p.y <= btnY + 10) {
                    currentLandingY = btnY;
                }
            }

            // 1. 公共运动逻辑：水平摇摆
            p.phase += p.swaySpeed * timeScale;
            if (p.state === 'resting') {
                // 已在进入状态时冻结 sway，此处无需操作
            }
            const currentSway = Math.sin(p.phase) * p.swayAmp;
            p.currentX = p.startX + currentSway;

            // 2. 状态机逻辑
            if (p.state === 'falling') {
                p.y += p.speed * timeScale;
                p.rotation += p.rotSpeed * timeScale;

                // 渐显效果
                if (p.opacity < 1) {
                    p.opacity += 0.02 * timeScale;
                    if (p.opacity > 1) p.opacity = 1;
                }

                // 落地检测
                if (p.y >= currentLandingY) {
                    if (p.willRest) {
                        p.state = 'resting';
                        p.y = currentLandingY;
                        // 彻底冻结 X 轴位置，防止滑动
                        p.startX = p.currentX;
                        p.swayAmp = 0;
                        p.swaySpeed = 0;
                    } else {
                        // 如果不应该停留，则直接转为 falling_through 继续下落
                        p.state = 'falling_through';
                    }
                }

            } else if (p.state === 'falling_through') {
                // 继续下落
                p.y += p.speed * timeScale;

                const realBottom = this.height - p.size;
                if (p.y < realBottom) {
                    p.opacity -= 0.002 * timeScale;
                } else {
                    p.opacity -= 0.03 * timeScale;
                }

            } else if (p.state === 'resting') {
                // 底部停留
                p.y = currentLandingY;
                p.restTime += 16.7 * timeScale;

                if (p.restTime > 2000 + Math.random() * 3000) {
                    // 时间到后融化 (原地消失)，而不是掉下去
                    p.state = 'melting';
                }
            } else if (p.state === 'melting') {
                // 融化逻辑：原地变透明
                p.opacity -= 0.01 * timeScale;
                // p.y 不变
            } else if (p.state === 'fading') {
                p.opacity = 0;
            }

            // 移除检测
            if (p.opacity <= 0 && (p.state === 'falling_through' || p.state === 'fading' || p.state === 'melting')) {
                p.el.remove();
                this.particles.splice(i, 1);
                continue;
            }

            // 渲染
            setPromptsCssVars(p.el, {
                opacity: String(p.opacity),
                transform: `translate3d(${p.currentX}px, ${p.y}px, 0) rotate(${p.rotation}deg)`
            });
        }

        this.frameId = requestAnimationFrame((t) => this.loop(t));
    }
};

// 兼容旧接口
function startContinuousParticles(container, theme) {
    ParticleSystem.init(container, theme);
}

// 停止粒子动画
function stopContinuousParticles() {
    ParticleSystem.stop();
}

function showBannerAnnouncement(color, size, content, ackKey, decoration) {
    const banner = document.getElementById('announcementBanner');
    const textEl = document.getElementById('announcementText');

    if (banner && textEl) {
        textEl.innerHTML = content;
        banner.className = 'announcement-banner color-' + color + ' size-' + size;
        banner.classList.remove('prompts-announcement-banner-hidden');
        banner.dataset.ackKey = ackKey;
        currentAnnouncementElement = banner;

        // Add decoration particles
        if (decoration && decoration !== 'none') {
            const existing = banner.querySelector('.decoration-particles');
            if (existing) existing.remove();
            banner.insertAdjacentHTML('beforeend', generateDecorationParticles(decoration));
            const particleContainer = banner.querySelector('.decoration-particles');
            if (particleContainer) {
                hydrateDecorationParticleStyles(particleContainer);
                startContinuousParticles(particleContainer, decoration);
            }
        }

        // Add class to body to offset fixed elements
        document.body.classList.add('has-banner');
        forcePromptPageTop();
    }
}

function showModalAnnouncement(color, size, content, ackKey, decoration) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'announcement-modal-overlay';
    overlay.dataset.ackKey = ackKey;

    const decorationHtml = generateDecorationParticles(decoration);

    overlay.innerHTML = `
        <div class="announcement-modal color-${color} size-${size}">
            ${decorationHtml}
            <div class="announcement-header">
                <div class="announcement-icon-wrapper">
                    <i class="fas fa-bullhorn"></i>
                </div>
                <span class="announcement-title">站内公告</span>
            </div>
            <div class="announcement-body">
                <div class="announcement-text">${content}</div>
            </div>
            <div class="announcement-footer">
                <button class="announcement-ack-btn" type="button">
                    已读
                </button>
            </div>
        </div>
    `;

    overlay.querySelector('.announcement-ack-btn')?.addEventListener('click', () => {
        closeAnnouncement(true);
    });

    // Close on overlay click (temporary close)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeAnnouncement(false);
        }
    });

    document.body.appendChild(overlay);
    currentAnnouncementElement = overlay;
    lockAnnouncementBackground(overlay);
    hydrateDecorationParticleStyles(overlay);

    // Start particle animation after DOM is ready
    if (decoration && decoration !== 'none') {
        if (decoration === 'hearts') {
            startHeartFloat(overlay);
        } else {
            // Only use active JS ParticleSystem for complex physics themes
            // Sakura and Leaves use the CSS-based particles we generated
            const activePhysicsThemes = ['snow', 'rain', 'fireworks'];

            if (activePhysicsThemes.includes(decoration)) {
                const particleContainer = overlay.querySelector('.decoration-particles');
                if (particleContainer) {
                    startContinuousParticles(particleContainer, decoration);
                }
            }
        }
    }
}

// ----------------------------------------
// Random Floating Heart Logic (Fade Out -> Teleport -> Fade In)
// ----------------------------------------
// ----------------------------------------
// Random Floating Heart Logic (Fade Out -> Teleport -> Fade In)
// With Collision Avoidance (Keep hearts apart)
// ----------------------------------------
function startHeartFloat(container) {
    const hearts = Array.from(container.querySelectorAll('.heart-container'));

    // Track current target positions (initialized with defaults)
    const positions = hearts.map(() => ({ x: 0, y: 0 }));

    hearts.forEach((heart, index) => {
        // --- Helper: Generate Safe Position ---
        const getSafePosition = () => {
            let safe = false;
            let attempts = 0;
            let newX, newY;

            while (!safe && attempts < 20) {
                // Generate random position (10% to 90%)
                newX = Math.random() * 80 + 10;
                newY = Math.random() * 80 + 10;
                safe = true;

                // Check distance against other hearts
                for (let i = 0; i < positions.length; i++) {
                    if (i === index) continue; // Skip self

                    // Only check if other heart has been initialized (not 0,0)
                    if (positions[i].x !== 0 && positions[i].y !== 0) {
                        const dist = Math.hypot(newX - positions[i].x, newY - positions[i].y);
                        if (dist < 40) { // Keep at least 40% screen width apart
                            safe = false;
                            break;
                        }
                    }
                }
                attempts++;
            }
            return { x: newX, y: newY };
        };

        // --- Initial Move ---
        const initialPos = getSafePosition();
        positions[index] = initialPos;
        setPromptsPercentPosition(heart, initialPos.x, initialPos.y);

        // --- Schedule Next Move ---
        const scheduleNextMove = () => {
            if (!document.body.contains(container)) return;

            // Random delay 10-18s
            const delay = 10000 + Math.random() * 8000;

            setTimeout(() => {
                if (!document.body.contains(container)) return;

                // 1. Fade Out
                heart.classList.add('relocating');

                // 2. Teleport after fade out (2s)
                setTimeout(() => {
                    if (!document.body.contains(container)) return;

                    // Generate new safe position
                    const newPos = getSafePosition();
                    positions[index] = newPos; // Update tracker

                    setPromptsPercentPosition(heart, newPos.x, newPos.y);

                    // 3. Fade In
                    requestAnimationFrame(() => {
                        heart.classList.remove('relocating');
                        scheduleNextMove();
                    });
                }, 2000);
            }, delay);
        };

        scheduleNextMove();
    });
}

let toastBackdropElement = null;

function showToastAnnouncement(color, size, content, ackKey, decoration) {
    // Create blur backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'announcement-toast-backdrop';
    document.body.appendChild(backdrop);
    toastBackdropElement = backdrop;

    const decorationHtml = generateDecorationParticles(decoration);

    // Create toast
    const toast = document.createElement('div');
    toast.className = 'announcement-toast color-' + color + ' size-' + size;
    toast.dataset.ackKey = ackKey;

    toast.innerHTML = `
        ${decorationHtml}
        <div class="toast-header">
            <i class="fas fa-bullhorn"></i>
            <span class="toast-title">站内公告</span>
        </div>
        <div class="toast-body">${content}</div>
        <button class="announcement-ack-btn-sm" type="button">已读</button>
    `;
    hydrateDecorationParticleStyles(toast);

    toast.querySelector('.announcement-ack-btn-sm')?.addEventListener('click', (event) => {
        event.stopPropagation();
        closeAnnouncement(true);
    });

    // Prevent clicks inside toast from closing
    toast.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Click backdrop to close
    backdrop.addEventListener('click', () => {
        closeAnnouncement(false);
    });

    document.body.appendChild(toast);
    currentAnnouncementElement = toast;
    lockAnnouncementBackground(toast);
}

function closeAnnouncement(acknowledged = false) {
    if (!currentAnnouncementElement) return;

    const ackKey = currentAnnouncementElement.dataset.ackKey;

    // If user clicked "已读", save to localStorage (permanent)
    // If user clicked X or overlay, don't save (will show again on refresh)
    if (acknowledged && ackKey) {
        localStorage.setItem(ackKey, 'true');
        console.log('用户已确认公告，不再显示');
    } else {
        console.log('用户临时关闭公告，刷新后将重新显示');
    }

    // Add closing animation class
    currentAnnouncementElement.classList.add('closing');

    // Stop particle animation
    stopContinuousParticles();

    // Also animate backdrop if exists
    if (toastBackdropElement) {
        toastBackdropElement.classList.add('closing');
    }

    // Remove after animation
    setTimeout(() => {
        clearCurrentAnnouncement();
    }, 300);
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
    const hasImages = Array.isArray(prompt?.images) && prompt.images.some((item) => hasPromptPageVisibleCopy(item));

    return hasBaseTitle && hasPromptText && hasImages;
}

function filterVisiblePromptsForPromptsPage(prompts = []) {
    return (Array.isArray(prompts) ? prompts : []).filter((prompt) => isPromptVisibleOnPromptsPage(prompt));
}

async function loadPromptsFromSupabase() {
    if (!window.supabaseClient) {
        console.log('Supabase client not available, using static data');
        return false;
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('prompts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase fetch error:', error);
            return false;
        }

        if (data && data.length > 0) {
            // Transform Supabase data to match PROMPTS format
            const supabasePrompts = data.map((item, index) => ({
                id: index,
                supabaseId: item.id, // Keep the real Supabase ID for reference
                title: item.title,
                title_en: item.title_en || '',
                title_zh: item.title_zh || '',
                tags: item.tags || [],
                description: item.description || '',
                description_en: item.description_en || '',
                description_zh: item.description_zh || '',
                prompt: item.prompt_text || '',
                prompt_text: item.prompt_text || '',
                prompt_text_en: item.prompt_text_en || '',
                prompt_text_zh: item.prompt_text_zh || '',
                images: item.images || [],
                dominantColors: item.dominant_colors || [],
                aiTags: item.ai_tags || {}
            }));
            const visibleSupabasePrompts = filterVisiblePromptsForPromptsPage(supabasePrompts);

            // REPLACE PROMPTS with only Supabase data (ignore local prompts-data.js)
            if (typeof PROMPTS !== 'undefined') {
                // Completely clear and replace with Supabase data
                while (PROMPTS.length > 0) {
                    PROMPTS.pop();
                }
                visibleSupabasePrompts.forEach(p => PROMPTS.push(p));
            } else {
                // If PROMPTS doesn't exist, create it
                window.PROMPTS = visibleSupabasePrompts;
            }

            console.log(`Loaded ${visibleSupabasePrompts.length} visible prompts from Supabase (filtered ${Math.max(0, supabasePrompts.length - visibleSupabasePrompts.length)} hidden prompts)`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('Error loading from Supabase:', err);
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
        const optimizedUrl = getOptimizedImageUrl(item?.images?.[0]);
        if (!optimizedUrl || promptGalleryImageWarmCache.has(optimizedUrl)) return;
        if (optimizedUrl.includes('supabase.co/storage/v1/render/image/public/')) return;

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

function setPromptCardImageSource(cardImage, originalUrl) {
    if (!cardImage || !originalUrl) return;

    const primaryUrl = getOptimizedImageUrl(originalUrl);
    const transformFallbackUrl = getOptimizedImageUrl(originalUrl, { format: '' });

    cardImage.dataset.originalSrc = originalUrl;
    cardImage.dataset.transformFallbackSrc = transformFallbackUrl !== primaryUrl ? transformFallbackUrl : '';
    cardImage.dataset.fallbackStage = '';
    cardImage.src = primaryUrl;
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

    // Build search index for fast lookups
    buildSearchIndex();
    void preloadPromptCommentCounts();

    initSpotlight();
    initAmbientLight(); // New: Living background
    initStarrySky(); // New: Starry background for dark mode
    generateDynamicNav(); // New: AI-driven navigation
    void renderFeaturedBanner(); // New: Today's featured artwork

    // Load gallery config (items per page, default sort) before rendering
    await loadGalleryConfig();

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

    renderGallery(initialFilter);
    setupFilters();
    setupInfiniteScroll();
    setupSearch(); // Pinterest-style search
    setupScrollReveal(); // New: Wave scroll animation
    checkAuthState(); // New: Check if admin is logged in
    loadAnnouncement(); // Load system announcement from config

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
        return;
    }

    // Show banner with fade-in + float-up animation
    banner.classList.add('featured-banner--visible', 'featured-banner--interactive');
    banner.classList.remove('featured-banner--revealed');
    requestAnimationFrame(() => {
        banner.classList.add('featured-banner--revealed');
        forcePromptPageTop();
    });

    // Set image (use first image from the array)
    if (image && featured.images && featured.images.length > 0) {
        image.src = featured.images[0];
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
}

async function renderFeaturedBanner() {
    const banner = document.getElementById('featuredBanner');
    if (!banner) return;

    if (!Array.isArray(PROMPTS) || PROMPTS.length === 0) {
        applyFeaturedBannerPrompt(null);
        return;
    }

    const homepageConfig = await loadHomepagePromptsConfigForBanner();
    const featured = resolveHomepageFeaturedBannerPrompt(homepageConfig) || resolveDailyFeaturedPrompt();
    applyFeaturedBannerPrompt(featured);
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
let currentFilter = 'all';
let isLoading = false;
let allFilteredItems = [];
let allCardsRendered = false; // Track if all cards have been rendered
let renderedCards = new Map(); // Cache rendered cards by id

// Load gallery config from system_config
let DEFAULT_SORT = 'newest'; // Default sort order

async function loadGalleryConfig() {
    try {
        if (!window.supabaseClient) return;

        const { data, error } = await window.supabaseClient
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'gallery')
            .single();

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
        }
    } catch (e) {
        console.warn('加载画廊配置失败:', e);
    }
}

// Sort PROMPTS array based on sort type
function sortPrompts(sortType) {
    if (!PROMPTS || PROMPTS.length === 0) return;

    // Helper: Extract numeric id from string format like "prompt-123"
    const getNumericId = (item) => {
        if (!item.id) return 0;
        if (typeof item.id === 'number') return item.id;
        // Extract number from string like "prompt-42"
        const match = String(item.id).match(/(\d+)/);
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
        const shouldLoadImageEagerly = index < PROMPT_GALLERY_EAGER_IMAGE_COUNT;
        const card = document.createElement('div');
        card.className = 'prompt-card card-enter prompt-card--loading';
        card.dataset.tags = item.tags.join(','); // For CSS filtering
        card.dataset.id = item.id;
        card.dataset.images = JSON.stringify(item.images); // Store all images
        card.onclick = () => openPromptModal(item.id);
        setPromptCardStaggerClass(card, index);

        // Generate image indicator dots if multiple images
        const hasMultiple = item.images.length > 1;
        const indicators = hasMultiple
            ? `<div class="card-indicators">${item.images.map((_, i) => `<span class="indicator-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
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
            setPromptCardImageSource(cardImage, item.images[0]);
        }
        cardImage?.addEventListener('load', () => {
            markPromptCardImageReady(card, cardImage);
        });
        cardImage?.addEventListener('error', () => {
            const transformFallbackSrc = cardImage.dataset.transformFallbackSrc;
            const originalSrc = cardImage.dataset.originalSrc || item.images[0];

            if (!cardImage.dataset.fallbackStage && transformFallbackSrc && cardImage.src !== transformFallbackSrc) {
                cardImage.dataset.fallbackStage = 'transform';
                cardImage.src = transformFallbackSrc;
                return;
            }

            if (cardImage.dataset.fallbackStage !== 'original' && originalSrc && cardImage.src !== originalSrc) {
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
        setTimeout(() => {
            card.classList.add('card-visible');
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
        const lowerQuery = query.toLowerCase();

        PROMPTS.forEach(p => {
            // Match titles
            if (p.title && p.title.toLowerCase().includes(lowerQuery)) {
                suggestions.add(p.title);
            }
            // Match tags
            if (p.tags) {
                p.tags.forEach(tag => {
                    if (tag.toLowerCase().includes(lowerQuery)) {
                        suggestions.add(tag);
                    }
                });
            }
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
    const cards = document.querySelectorAll('.prompt-card');

    // If no query, show all cards
    if (!query) {
        let visibleIndex = 0;
        cards.forEach(card => {
            showPromptCard(card, visibleIndex);
            visibleIndex++;
        });
        // Re-select "All" when search cleared
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
        if (aliases.some(alias => query.includes(alias))) {
            searchingForColor = colorKey;
            break;
        }
    }

    // === 3-LAYER SEARCH STRATEGY ===

    // Layer 1 & 2: Local search (instant, no network)
    const localResults = performLocalSearch(query, searchingForColor);
    console.log(`🔍 Local search: found ${localResults.size} results for "${query}"`);

    // If local search found results, use them directly
    if (localResults.size > 0) {
        applySearchResults(cards, localResults, searchingForColor);
        return;
    }

    // Layer 3: AI Semantic Search (only if local search failed)
    // Check rate limit for non-admin users
    if (!isAdmin && !checkAISearchRateLimit()) {
        console.log('⏳ AI search rate limited');
        showSearchCooldownMessage();
        applySearchResults(cards, new Set(), searchingForColor); // Show no results
        return;
    }

    // Trigger AI semantic search
    console.log('🔍 Local search: 0 results, triggering AI semantic search...');
    const aiResults = await performAISemanticSearch(query);

    if (aiResults.size > 0) {
        console.log(`✨ AI search: found ${aiResults.size} results`);
        applySearchResults(cards, aiResults, searchingForColor);
    } else {
        console.log('❌ AI search: no results found');
        applySearchResults(cards, new Set(), searchingForColor);
    }
}

// Expand query using synonym dictionary
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

// Layer 1 & 2: Local search with synonym expansion + index optimization
// 【优化】原始词做精确+部分匹配，同义词只做精确匹配
function performLocalSearch(query, searchingForColor) {
    const matchedIds = new Set();
    const originalQuery = query.toLowerCase().trim();
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

    console.log(`📊 Index size: ${Object.keys(SEARCH_INDEX).length} terms`);

    // === 策略1：原始搜索词 - 精确匹配 + 部分匹配 ===
    if (SEARCH_INDEX[originalQuery]) {
        console.log(`✅ Direct match for "${originalQuery}":`, SEARCH_INDEX[originalQuery]);
        SEARCH_INDEX[originalQuery].forEach(id => matchedIds.add(id));
    }
    // 部分匹配 - 只对原始搜索词进行
    if (originalQuery.length >= 2) {
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

    // If index search found nothing, fall back to linear search for fuzzy matching
    if (matchedIds.size === 0) {
        console.log('📝 Index miss, using linear fallback...');
        PROMPTS.forEach((item, index) => {
            if (!item) return;

            for (const term of expandedTerms) {
                // Check description and prompt text (not indexed)
                const descMatch = item.description?.toLowerCase().includes(term);
                const promptMatch = item.prompt?.toLowerCase().includes(term);

                if (descMatch || promptMatch) {
                    matchedIds.add(index);
                    break;
                }
            }
        });
    }

    return matchedIds;
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
                const tagLower = tag.toLowerCase();
                PROMPTS.forEach((item, index) => {
                    if (!item) return;

                    // Check title, tags, aiTags
                    const titleMatch = item.title?.toLowerCase().includes(tagLower);
                    const tagMatch = item.tags?.some(t => t.toLowerCase().includes(tagLower));

                    let aiMatch = false;
                    if (item.aiTags) {
                        const searchIn = (arr) => arr && arr.some(t => t && t.toLowerCase().includes(tagLower));
                        aiMatch = searchIn(item.aiTags.objects?.en) ||
                            searchIn(item.aiTags.styles?.en) ||
                            searchIn(item.aiTags.scenes?.en) ||
                            searchIn(item.aiTags.mood?.en);
                    }

                    if (titleMatch || tagMatch || aiMatch) {
                        matchedIds.add(index);
                    }
                });
            }
        }
    } catch (e) {
        console.error('AI semantic search error:', e);
    }

    return matchedIds;
}

// Apply search results to cards with animation
function applySearchResults(cards, matchedIds, searchingForColor) {
    let visibleIndex = 0;

    cards.forEach(card => {
        const cardId = parseInt(card.dataset.id);
        const item = PROMPTS[cardId];
        if (!item) return;

        let isVisible = matchedIds.has(cardId);

        // For color searches with no AI semantic involvement, also check colors
        if (searchingForColor && !isVisible) {
            isVisible = item.dominantColors && item.dominantColors.includes(searchingForColor);
        }

        if (isVisible) {
            showPromptCard(card, visibleIndex);
            visibleIndex++;
        } else {
            hidePromptCard(card, false);
        }
    });

    // Update nav items - deselect all when searching
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
    preLiftActive: false
};

let promptModalOpeningTimer = null;
let promptModalDockTimers = [];
let promptModalStatusBarShield = null;
let promptModalBaseScrollY = 0;

function getPromptModalBaseScrollY() {
    return Math.max(0, Math.round(promptModalBaseScrollY || 0));
}

function scrollPromptModalPageToBase() {
    const targetY = getPromptModalBaseScrollY();
    if ((window.scrollY || window.pageYOffset || 0) !== targetY) {
        window.scrollTo(0, targetY);
    }
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

function togglePromptModalSheetAnimation(modalInner, animate, duration = 180) {
    clearPromptModalTransitionCleanupTimer();
    if (!modalInner) return;

    modalInner.classList.toggle('prompt-modal-animating', !!animate);
    if (!animate) return;

    promptModalKeyboardDock.transitionCleanupTimer = setTimeout(() => {
        const { modalInner: activeInner } = getPromptModalDockNodes();
        promptModalKeyboardDock.transitionCleanupTimer = null;
        activeInner?.classList.remove('prompt-modal-animating');
    }, duration + 40);
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
    if (!isPromptModalDockEnabledOrActive() || promptModalKeyboardDock.docked || promptModalKeyboardDock.preLiftActive) return;
    const { modalInner } = getPromptModalDockNodes();
    if (!modalInner) return;

    clearPromptModalPreLiftCleanupTimer();
    promptModalKeyboardDock.preLiftActive = true;
    setPromptsCssVars(modalInner, {
        'will-change': 'transform',
        transition: 'transform 120ms cubic-bezier(0.22, 1, 0.36, 1)',
        '--prompt-modal-scale': '1',
        '--prompt-modal-translate-y': '-24px'
    });
    promptModalKeyboardDock.preLiftCleanupTimer = setTimeout(() => {
        promptModalKeyboardDock.preLiftCleanupTimer = null;
        if (!promptModalKeyboardDock.docked) {
            clearPromptModalKeyboardPreLift(true);
        } else {
            promptModalKeyboardDock.preLiftActive = false;
        }
    }, 150);
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

    document.getElementById('announcementCloseBtn')?.addEventListener('click', () => {
        closeAnnouncement(true);
    });
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
    setPromptModalStatusBarShieldExpanded(false);
    shield.classList.add('prompt-status-bar-shield--active');
    requestAnimationFrame(() => {
        shield.classList.add('prompt-status-bar-shield--visible');
    });
}

function hidePromptModalStatusBarShield() {
    if (!promptModalStatusBarShield) return;
    promptModalStatusBarShield.classList.remove('prompt-status-bar-shield--visible');
    setPromptModalStatusBarShieldExpanded(false);

    setTimeout(() => {
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
}

function clearPromptModalKeyboardSettleTimer() {
    if (promptModalKeyboardDock.keyboardSettleTimer) {
        clearTimeout(promptModalKeyboardDock.keyboardSettleTimer);
        promptModalKeyboardDock.keyboardSettleTimer = null;
    }
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
    const duration = animate ? 180 : 0;

    if (promptModalKeyboardDock.docked && promptModalKeyboardDock.animatingUntil > now) {
        if (Math.abs(bottomInset - promptModalKeyboardDock.lastKeyboardInset) <= 8) {
            return;
        }
    }

    clearPromptModalUndockTimer();
    clearPromptModalFirstDockTimer();
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
    const duration = animate ? 180 : 0;
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
                    applyPromptModalKeyboardDock(visualHeight, bottomInset, true);
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
    promptModalKeyboardDock.attached = true;
}

function detachPromptModalKeyboardDock() {
    const vv = window.visualViewport;
    if (vv && promptModalKeyboardDock.onViewportChange) {
        vv.removeEventListener('resize', requestPromptModalViewportSync);
        vv.removeEventListener('scroll', requestPromptModalViewportSync);
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

function openPromptModal(id) {
    const item = PROMPTS.find(p => p.id === id);
    if (!item) return;

    promptModalBaseScrollY = window.scrollY || window.pageYOffset || 0;

    currentPromptId = item.supabaseId || item.id; // Prefer persistent UUID if available
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
    currentModalImages = item.images || [];
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
    newImg.src = currentModalImages[0];
    newImg.alt = getLocalizedField(item, 'title');

    // Insert before nav buttons
    const firstBtn = imgContainer.querySelector('.modal-img-nav');
    imgContainer.insertBefore(newImg, firstBtn);

    // Populate Data (with i18n support)
    document.getElementById('modalTitle').textContent = getLocalizedField(item, 'title');
    document.getElementById('modalDesc').textContent = getLocalizedField(item, 'description');

    // Set prompt text (ensure clean connection) - use localized version if available
    promptText.textContent = getLocalizedField(item, 'prompt_text') || item.prompt;

    // Tags hidden as per user request
    const tagsContainer = document.getElementById('modalTags');
    tagsContainer.innerHTML = ''; // Hidden
    renderPromptModalContentTags(item);

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
            .select('*')
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
            }
            setPromptUnlocked();
            console.log('[Unlock] Success! New Balance:', data.new_balance);
        } else {
            const errMsg = data?.error || '解锁失败';
            alert(errMsg);
            // If insufficient points, open wallet modal for recharging
            if (errMsg.includes('积分不足') || errMsg.includes('Insufficient')) {
                if (typeof WalletModal !== 'undefined' && WalletModal.open) {
                    WalletModal.open('recharge', {
                        entry: 'unlock_insufficient_points',
                        sourceModule: 'prompt_gallery',
                        promptId: String(currentPromptId || '').trim(),
                        category: promptMetadata.category || null
                    });
                } else if (window.WalletModal && window.WalletModal.open) {
                    window.WalletModal.open('recharge', {
                        entry: 'unlock_insufficient_points',
                        sourceModule: 'prompt_gallery',
                        promptId: String(currentPromptId || '').trim(),
                        category: promptMetadata.category || null
                    });
                }
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
        // Use localized field to respect language preference
        promptText.textContent = getLocalizedField(promptItem, 'prompt_text') || promptItem.prompt;
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
let promptCommentComposerLastBottomInset = 0;
let promptCommentComposerInsetDropTimer = null;
let promptCommentComposerPendingInset = 0;
let promptCommentComposerDocked = false;
let promptCommentComposerInitialDockTimer = null;
let promptCommentComposerBaseSheetHeight = 0;
let promptCommentComposerOwnsScrollLock = false;
let promptCommentComposerScrollClampCleanup = null;
let promptCommentComposerStableViewportProbe = null;
let promptCommentComposerAuthAlertTimer = null;
let promptCommentComposerLoginModalTimer = null;
const PROMPT_COMMENT_COMPOSER_AUTH_ALERT_DURATION_MS = 1080;

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
    if (!probe) return 0;
    const rectHeight = Math.round(probe.getBoundingClientRect().height || probe.offsetHeight || 0);
    return Math.max(0, rectHeight);
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
        focusPromptCommentComposerInputWithoutScroll(input);
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
    if (promptCommentComposerInitialDockTimer) {
        clearTimeout(promptCommentComposerInitialDockTimer);
        promptCommentComposerInitialDockTimer = null;
    }
    if (promptCommentComposerInsetDropTimer) {
        clearTimeout(promptCommentComposerInsetDropTimer);
        promptCommentComposerInsetDropTimer = null;
    }
    promptCommentComposerPendingInset = 0;
}

function unlockPromptCommentComposerPage() {
    if (typeof promptCommentComposerScrollClampCleanup === 'function') {
        promptCommentComposerScrollClampCleanup();
        promptCommentComposerScrollClampCleanup = null;
    }
    if (promptCommentComposerOwnsScrollLock && window.iOSScrollLock) {
        window.iOSScrollLock.unlock();
        scrollPromptModalPageToBase();
        const modalInner = document.querySelector('#promptModal .modal-inner');
        const modal = document.getElementById('promptModal');
        if (modal?.classList.contains('active') && modalInner) {
            window.iOSScrollLock.lockLight(modalInner);
        }
    }
    promptCommentComposerOwnsScrollLock = false;
}

function lockPromptCommentComposerPage() {
    const { overlay } = getPromptCommentComposerElements();
    const sheet = overlay?.querySelector('.prompt-comment-composer-sheet');
    if (window.iOSScrollLock && sheet) {
        window.iOSScrollLock.lock(sheet);
        promptCommentComposerOwnsScrollLock = true;
    }
}

function resetPromptCommentComposerViewportStyles() {
    const { overlay, input, sheet } = getPromptCommentComposerElements();
    if (!overlay) return;
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
    promptCommentComposerLastBottomInset = 0;
    promptCommentComposerOwnsScrollLock = false;
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
    const visualHeight = Math.max(0, vv?.height || 0);
    const fallbackBaseHeight = Math.max(
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualHeight
    );
    const stableViewportHeight = getPromptCommentComposerStableViewportHeight();
    const normalizedBaseHeight = (stableViewportHeight > 0 && stableViewportHeight + 24 < fallbackBaseHeight)
        ? stableViewportHeight
        : fallbackBaseHeight;

    // When the page is scrolled down on iOS, Safari may collapse the bottom bar
    // before focus. Using that larger visual viewport as the keyboard baseline
    // makes the first dock overshoot once the browser chrome expands again.
    promptCommentComposerBaseViewportHeight = normalizedBaseHeight;
    promptCommentComposerBaseVisualHeight = normalizedBaseHeight;
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
    const visualHeight = Math.max(0, vv?.height || 0);
    const baseVisualHeight = Math.max(
        promptCommentComposerBaseVisualHeight || 0,
        promptCommentComposerBaseViewportHeight || 0
    );
    const bottomInset = Math.max(
        0,
        baseVisualHeight - visualHeight
    );

    return {
        visualHeight,
        baseVisualHeight,
        bottomInset: Math.max(0, Math.round(bottomInset))
    };
}

function applyPromptCommentComposerDock(bottomInset, animate = false) {
    const { overlay, sheet } = getPromptCommentComposerElements();
    if (!overlay || !sheet) return;

    if (!promptCommentComposerOwnsScrollLock) {
        lockPromptCommentComposerPage();
    }

    const metrics = getPromptCommentComposerViewportMetrics();
    if (!promptCommentComposerBaseSheetHeight) {
        const liveHeight = Math.round(sheet.offsetHeight || sheet.getBoundingClientRect().height || 400);
        promptCommentComposerBaseSheetHeight = liveHeight || 400;
    }

    const baseSheetHeight = Math.max(320, promptCommentComposerBaseSheetHeight || 400);
    const baseViewportHeight = Math.max(metrics.baseVisualHeight || 0, promptCommentComposerBaseViewportHeight || 0);
    const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
    const minTop = 12;
    const maxAvailableHeight = Math.max(260, Math.round(keyboardTop - minTop - 12));
    const dockHeight = Math.min(baseSheetHeight, maxAvailableHeight);
    const centeredTop = (baseViewportHeight - dockHeight) / 2;
    const desiredTop = Math.max(minTop, keyboardTop - 12 - dockHeight);
    const deltaY = Math.round(desiredTop - centeredTop);

    setPromptsCssVars(overlay, {
        '--composer-keyboard-offset': `${bottomInset}px`
    });
    overlay.classList.toggle('keyboard-active', bottomInset > 0);
    overlay.classList.toggle('keyboard-docked-active', bottomInset > 0);
    setPromptsCssVars(sheet, {
        height: `${dockHeight}px`,
        'max-height': `${dockHeight}px`
    });

    if (window.promptCommentComposerAnimRafId) {
        clearTimeout(window.promptCommentComposerAnimRafId);
        window.promptCommentComposerAnimRafId = null;
    }

    sheet.classList.toggle('composer-animating', !!animate);
    if (animate) {
        window.promptCommentComposerAnimRafId = setTimeout(() => {
            sheet.classList.remove('composer-animating');
            window.promptCommentComposerAnimRafId = null;
        }, 200);
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
        window.promptCommentComposerAnimRafId = setTimeout(() => {
            sheet.classList.remove('composer-animating');
            window.promptCommentComposerAnimRafId = null;
        }, 200);
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

    const shouldDock = isFocused && (promptCommentComposerDocked ? bottomInset > 8 : bottomInset > 24);
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
                applyPromptCommentComposerDock(liveMetrics.bottomInset, false);
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
        promptCommentComposerPendingInset = nextInset;
        if (!promptCommentComposerInsetDropTimer) {
            promptCommentComposerInsetDropTimer = setTimeout(() => {
                promptCommentComposerInsetDropTimer = null;
                const settledInset = promptCommentComposerPendingInset;
                promptCommentComposerPendingInset = 0;
                if (settledInset > 24) {
                    applyPromptCommentComposerDock(settledInset, false);
                }
            }, 90);
        }
        return;
    }

    if (promptCommentComposerDocked && isFocused && nextInset <= 24) {
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

    vv.addEventListener('resize', handleViewportChange, { passive: true });
    input?.addEventListener('focus', handleViewportChange);
    input?.addEventListener('blur', handleViewportChange);

    promptCommentComposerViewportCleanup = () => {
        vv.removeEventListener('resize', handleViewportChange);
        input?.removeEventListener('focus', handleViewportChange);
        input?.removeEventListener('blur', handleViewportChange);
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

// Upload image to Supabase Storage
async function uploadCommentImage(file) {
    if (!window.supabaseClient) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data, error } = await window.supabaseClient.storage
        .from('comment-images')
        .upload(filePath, file);

    if (error) {
        console.error('Upload error:', error);
        return null;
    }

    // Get public URL
    const { data: { publicUrl } } = window.supabaseClient.storage
        .from('comment-images')
        .getPublicUrl(filePath);

    return publicUrl;
}

// Open image in lightbox
function openImageLightbox(imageUrl) {
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
    img.src = imageUrl;

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

    if (realtimeChannel && realtimeChannelSite !== site) {
        try {
            realtimeChannel.unsubscribe?.();
        } catch (_) {
            // Ignore cleanup failures during local dev/site swaps.
        }
        realtimeChannel = null;
    }

    realtimeChannelSite = site;
    realtimeChannel = window.supabaseClient
        .channel(`prompt-comments-updates-${site}`)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'prompt_comments', filter: `site=eq.${site}` },
            handleRealtimeCommentInsert
        )
        .subscribe();
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
                ${comment.image_url ? `
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
        .select('*')
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
        // Restore smooth exit animation by fading out the background over 500ms.
        // We removed the HTML background hacks, so Safari will safely composite the stable 
        // 0.6 opacity backdrop against the normal page without freezing the address bar.
        backdrop.classList.add('closing');
        backdrop.classList.remove('visible');
    }

    detachPromptModalKeyboardDock();
    restorePromptModalOverlay();

    // Give CSS 200ms to fade out, then clean up the DOM and unlock scroll
    setTimeout(() => {
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
