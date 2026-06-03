const HOMEPAGE_SITE_VALUES = Object.freeze(['cn', 'intl']);
const HOMEPAGE_SECTION_ORDER = Object.freeze(['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker']);
const HOMEPAGE_SECTION_SET = new Set(HOMEPAGE_SECTION_ORDER);
const HOMEPAGE_EDITOR_SCHEMA_VERSION = 'p2_v1';
const HOMEPAGE_SORT_VALUES = new Set(['popular', 'latest', 'random']);
const HOMEPAGE_GONGYI_TARGET_URL = 'https://sub2api.fatherkey.com';
const HOMEPAGE_LEGACY_GONGYI_HOSTS = new Set(['gongyi.zaoyoe.com', 'www.gongyi.zaoyoe.com']);
const HOMEPAGE_EXPERIMENT_FIELD_RULES = Object.freeze({
    hero: Object.freeze({
        title: 'text',
        subtitle: 'text'
    }),
    prompts: Object.freeze({
        featured_items: 'prompt_items'
    }),
    shop: Object.freeze({
        custom_items: 'shop_items'
    }),
    verify: Object.freeze({
        cta_text: 'text'
    }),
    guestbook: Object.freeze({
        featured_items: 'guestbook_items'
    })
});

function normalizeHomepageSite(site) {
    return site === 'intl' ? 'intl' : 'cn';
}

function normalizeHomepageSection(section) {
    const normalized = String(section || '').trim().toLowerCase();
    return HOMEPAGE_SECTION_SET.has(normalized) ? normalized : '';
}

function sanitizeText(value, fallback = '', maxLength = 240) {
    const normalized = String(value ?? fallback ?? '').trim();
    if (!normalized) {
        return '';
    }
    return normalized.slice(0, Math.max(0, maxLength));
}

function sanitizeInteger(value, {
    fallback = 0,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER
} = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function sanitizeBoolean(value, fallback = false) {
    if (value === true || value === false) {
        return value;
    }
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    return fallback;
}

function sanitizeArray(value) {
    return Array.isArray(value) ? value : [];
}

function sanitizeUrl(value, fallback = '', maxLength = 2048) {
    const normalized = sanitizeText(value, fallback, maxLength);
    if (!normalized) {
        return '';
    }
    if (normalized.startsWith('data:image/')) {
        return fallback || '';
    }
    if (/^https?:\/\//i.test(normalized) || normalized.startsWith('/') || normalized.startsWith('#')) {
        return normalized;
    }
    return normalized;
}

function normalizeHomepageGongyiUrl(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }

    try {
        const parsed = new URL(normalized);
        if (HOMEPAGE_LEGACY_GONGYI_HOSTS.has(parsed.hostname.toLowerCase())) {
            const path = parsed.pathname === '/' ? '' : parsed.pathname;
            return `${HOMEPAGE_GONGYI_TARGET_URL}${path}${parsed.search}${parsed.hash}`;
        }
    } catch (_error) {
        // Keep non-absolute URLs unchanged.
    }

    return normalized;
}

function normalizeTranslatedPair(target, fieldBase, maxLength = 240) {
    const base = sanitizeText(target?.[fieldBase], '', maxLength);
    const zh = sanitizeText(target?.[`${fieldBase}_zh`], '', maxLength);
    const en = sanitizeText(target?.[`${fieldBase}_en`], '', maxLength);

    if (base) {
        target[fieldBase] = base;
    } else {
        delete target[fieldBase];
    }

    if (zh) {
        target[`${fieldBase}_zh`] = zh;
    } else {
        delete target[`${fieldBase}_zh`];
    }

    if (en) {
        target[`${fieldBase}_en`] = en;
    } else {
        delete target[`${fieldBase}_en`];
    }

    return target;
}

function preserveTranslatedPair(target, source, fieldBase, maxLength = 240) {
    target[`${fieldBase}_zh`] = sanitizeText(source?.[`${fieldBase}_zh`], '', maxLength);
    target[`${fieldBase}_en`] = sanitizeText(source?.[`${fieldBase}_en`], '', maxLength);
    return normalizeTranslatedPair(target, fieldBase, maxLength);
}

function normalizeStringList(value, {
    maxItems = 12,
    maxLength = 80
} = {}) {
    return sanitizeArray(value)
        .map((item) => sanitizeText(item, '', maxLength))
        .filter(Boolean)
        .slice(0, maxItems);
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

            const id = sanitizeText(item.id, '', 160);
            if (!id) {
                return null;
            }

            const normalized = {
                id,
                title: sanitizeText(item.title, '', 240),
                title_zh: sanitizeText(item.title_zh, '', 240),
                title_en: sanitizeText(item.title_en, '', 240),
                image: sanitizeUrl(item.image || item.image_url, '', 2048),
                tags: normalizeStringList(item.tags, { maxItems: 8, maxLength: 80 })
            };

            if (!normalized.title) delete normalized.title;
            if (!normalized.title_zh) delete normalized.title_zh;
            if (!normalized.title_en) delete normalized.title_en;
            if (!normalized.image) delete normalized.image;
            if (!normalized.tags.length) delete normalized.tags;

            return normalized;
        })
        .filter(Boolean);
}

function normalizeHomepageHeroCtaConfig(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const cta = {
        primary: {
            text: sanitizeText(source?.primary?.text, '', 48),
            link: normalizeHomepageGongyiUrl(sanitizeUrl(source?.primary?.link, '', 1024))
        },
        secondary: {
            text: sanitizeText(source?.secondary?.text, '', 48),
            link: normalizeHomepageGongyiUrl(sanitizeUrl(source?.secondary?.link, '', 1024))
        }
    };

    if (!cta.primary.text && !cta.primary.link && !cta.secondary.text && !cta.secondary.link) {
        return undefined;
    }

    return cta;
}

function normalizeHomepageHeroEntries(value) {
    return sanitizeArray(value)
        .map((item, index) => {
            if (!item || typeof item !== 'object') return null;

            const text = sanitizeText(item.text, '', 48);
            const id = sanitizeText(item.id, '', 160)
                || sanitizeText(item.link, '', 160)
                || sanitizeText(item.section, '', 80)
                || sanitizeText(item.action, '', 80)
                || (text ? `entry_${index + 1}` : '');

            if (!id || !text) return null;

            const normalized = {
                id,
                text,
                text_zh: sanitizeText(item.text_zh, '', 48),
                text_en: sanitizeText(item.text_en, '', 48),
                link: normalizeHomepageGongyiUrl(sanitizeUrl(item.link, '', 1024)),
                icon: sanitizeText(item.icon, '', 80),
                color: sanitizeText(item.color, '', 40),
                action: sanitizeText(item.action, '', 80),
                section: sanitizeText(item.section, '', 80),
                enabled: sanitizeBoolean(item.enabled, true)
            };

            if (!normalized.text_zh) delete normalized.text_zh;
            if (!normalized.text_en) delete normalized.text_en;
            if (!normalized.link) delete normalized.link;
            if (!normalized.icon) delete normalized.icon;
            if (!normalized.color) delete normalized.color;
            if (!normalized.action) delete normalized.action;
            if (!normalized.section) delete normalized.section;
            if (normalized.enabled !== false) delete normalized.enabled;

            return normalized;
        })
        .filter(Boolean)
        .slice(0, 8);
}

function normalizeHomepageVerifyDisplayLabel(value) {
    const text = sanitizeText(value, '', 120);
    return ['验证', 'Verify', 'API 验证', 'API Verification', 'Gemini 验证', 'Gemini Verify', 'Gemini验证', 'Google One', 'Google one'].includes(text)
        ? 'Gemini Pro'
        : text;
}

function normalizeHomepageShopCustomItems(value) {
    return sanitizeArray(value)
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const id = sanitizeText(item.id, '', 160);
            if (!id) {
                return null;
            }

            const normalized = {
                id,
                name: sanitizeText(item.name, '', 160),
                name_zh: sanitizeText(item.name_zh, '', 160),
                name_en: sanitizeText(item.name_en, '', 160),
                description: sanitizeText(item.description, '', 320),
                description_zh: sanitizeText(item.description_zh, '', 320),
                description_en: sanitizeText(item.description_en, '', 320),
                icon_url: sanitizeUrl(item.icon_url, '', 2048),
                category: sanitizeText(item.category, '', 120),
                badge: sanitizeText(item.badge, '', 80),
                stock_count: sanitizeInteger(item.stock_count, { fallback: 0, min: -999999, max: 999999 }),
                is_active: sanitizeBoolean(item.is_active, true)
            };

            if (!normalized.name) delete normalized.name;
            if (!normalized.name_zh) delete normalized.name_zh;
            if (!normalized.name_en) delete normalized.name_en;
            if (!normalized.description) delete normalized.description;
            if (!normalized.description_zh) delete normalized.description_zh;
            if (!normalized.description_en) delete normalized.description_en;
            if (!normalized.icon_url) delete normalized.icon_url;
            if (!normalized.category) delete normalized.category;
            if (!normalized.badge) delete normalized.badge;
            if (normalized.stock_count === 0 && item.stock_count == null) delete normalized.stock_count;
            if (normalized.is_active !== false) delete normalized.is_active;

            return normalized;
        })
        .filter(Boolean)
        .slice(0, 24);
}

function normalizeHomepageGuestbookFeaturedItems(value) {
    return sanitizeArray(value)
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const id = sanitizeText(item.id, '', 160);
            const content = sanitizeText(item.content || item.content_zh || item.content_en, '', 600);
            if (!id || !content) {
                return null;
            }

            const normalized = {
                id,
                content,
                content_zh: sanitizeText(item.content_zh, '', 600),
                content_en: sanitizeText(item.content_en, '', 600),
                image_url: sanitizeUrl(item.image_url, '', 2048),
                like_count: sanitizeInteger(item.like_count, { fallback: 0, min: 0, max: 999999 }),
                created_at: sanitizeText(item.created_at, '', 80),
                user_id: sanitizeText(item.user_id, '', 160),
                username: sanitizeText(item.username || item?.profiles?.username, '', 120),
                username_zh: sanitizeText(item.username_zh, '', 120),
                username_en: sanitizeText(item.username_en, '', 120),
                avatar_url: sanitizeUrl(item.avatar_url || item?.profiles?.avatar_url, '', 2048),
                reason: sanitizeText(item.reason || item.reason_zh || item.reason_en, '', 160),
                reason_zh: sanitizeText(item.reason_zh, '', 160),
                reason_en: sanitizeText(item.reason_en, '', 160)
            };

            if (!normalized.content_zh) delete normalized.content_zh;
            if (!normalized.content_en) delete normalized.content_en;
            if (!normalized.image_url) delete normalized.image_url;
            if (!normalized.like_count && item.like_count == null) delete normalized.like_count;
            if (!normalized.created_at) delete normalized.created_at;
            if (!normalized.user_id) delete normalized.user_id;
            if (!normalized.username) delete normalized.username;
            if (!normalized.username_zh) delete normalized.username_zh;
            if (!normalized.username_en) delete normalized.username_en;
            if (!normalized.avatar_url) delete normalized.avatar_url;
            if (!normalized.reason) delete normalized.reason;
            if (!normalized.reason_zh) delete normalized.reason_zh;
            if (!normalized.reason_en) delete normalized.reason_en;

            return normalized;
        })
        .filter(Boolean)
        .slice(0, 12);
}

function normalizeHomepageGuestbookFallbackItems(value) {
    return sanitizeArray(value)
        .map((item, index) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const content = sanitizeText(item.content || item.text || item.content_zh || item.content_en, '', 600);
            if (!content) {
                return null;
            }

            const normalized = {
                id: sanitizeText(item.id, '', 160) || `fallback_${index + 1}`,
                content,
                content_zh: sanitizeText(item.content_zh, '', 600),
                content_en: sanitizeText(item.content_en, '', 600),
                author: sanitizeText(item.author, '', 120),
                author_zh: sanitizeText(item.author_zh, '', 120),
                author_en: sanitizeText(item.author_en, '', 120),
                avatar_url: sanitizeUrl(item.avatar_url, '', 2048)
            };

            if (!normalized.content_zh) delete normalized.content_zh;
            if (!normalized.content_en) delete normalized.content_en;
            if (!normalized.author) delete normalized.author;
            if (!normalized.author_zh) delete normalized.author_zh;
            if (!normalized.author_en) delete normalized.author_en;
            if (!normalized.avatar_url) delete normalized.avatar_url;

            return normalized;
        })
        .filter(Boolean)
        .slice(0, 8);
}

function normalizeHomepageGongyiModelItems(value) {
    return sanitizeArray(value)
        .map((item, index) => {
            if (typeof item === 'string') {
                const label = sanitizeText(item, '', 48);
                if (!label) {
                    return null;
                }

                return {
                    id: `model_${index + 1}`,
                    label,
                    enabled: true
                };
            }

            if (!item || typeof item !== 'object') {
                return null;
            }

            const label = sanitizeText(item.label || item.name || item.title, '', 48);
            if (!label) {
                return null;
            }

            const normalized = {
                id: sanitizeText(item.id, '', 160) || `model_${index + 1}`,
                label,
                enabled: sanitizeBoolean(item.enabled, true)
            };

            if (normalized.enabled !== false) delete normalized.enabled;

            return normalized;
        })
        .filter(Boolean)
        .slice(0, 8);
}

function cloneNormalizedHomepageExperimentValue(value, valueType) {
    if (valueType === 'text') {
        return sanitizeText(value, '', 600);
    }

    if (Array.isArray(value)) {
        return value.map((item) => ({ ...item }));
    }

    return value;
}

function normalizeHomepageExperimentFieldValue(section, field, value) {
    const ruleType = HOMEPAGE_EXPERIMENT_FIELD_RULES?.[normalizeHomepageSection(section)]?.[field] || '';

    switch (ruleType) {
        case 'text':
            return sanitizeText(value, '', 600);
        case 'prompt_items':
            return normalizeHomepageFeaturedPromptItems(value);
        case 'shop_items':
            return normalizeHomepageShopCustomItems(value);
        case 'guestbook_items':
            return normalizeHomepageGuestbookFeaturedItems(value);
        default:
            return null;
    }
}

function areHomepageExperimentValuesEquivalent(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeHomepageSectionExperiments(section, value) {
    const normalizedSection = normalizeHomepageSection(section);
    const fieldRules = HOMEPAGE_EXPERIMENT_FIELD_RULES[normalizedSection] || {};

    return sanitizeArray(value)
        .map((item, index) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const field = sanitizeText(item.field, '', 80);
            const valueType = fieldRules[field];
            if (!valueType) {
                return null;
            }

            const controlValue = normalizeHomepageExperimentFieldValue(normalizedSection, field, item.control_value);
            const variantValue = normalizeHomepageExperimentFieldValue(normalizedSection, field, item.variant_value);
            const hasTextValue = valueType === 'text';
            const hasControl = hasTextValue ? Boolean(controlValue) : Array.isArray(controlValue) && controlValue.length > 0;
            const hasVariant = hasTextValue ? Boolean(variantValue) : Array.isArray(variantValue) && variantValue.length > 0;

            if (!hasControl || !hasVariant || areHomepageExperimentValuesEquivalent(controlValue, variantValue)) {
                return null;
            }

            const normalized = {
                id: sanitizeText(item.id, '', 160) || `exp_${normalizedSection}_${field}_${index + 1}`,
                name: sanitizeText(item.name, '', 120) || `${normalizedSection}_${field}_${index + 1}`,
                field,
                status: sanitizeText(item.status, 'active', 40) === 'paused' ? 'paused' : 'active',
                traffic_percent: sanitizeInteger(item.traffic_percent, { fallback: 50, min: 5, max: 95 }),
                control_value: cloneNormalizedHomepageExperimentValue(controlValue, valueType),
                variant_value: cloneNormalizedHomepageExperimentValue(variantValue, valueType),
                created_at: sanitizeText(item.created_at, '', 80),
                updated_at: sanitizeText(item.updated_at, '', 80)
            };

            if (!normalized.created_at) delete normalized.created_at;
            if (!normalized.updated_at) delete normalized.updated_at;

            return normalized;
        })
        .filter(Boolean)
        .slice(0, 6);
}

function buildEmptyHomepageSectionContent(section) {
    switch (section) {
        case 'hero':
            return {
                enable_auto: false,
                title: '',
                subtitle: '',
                cta: {
                    primary: { text: '', link: '' },
                    secondary: { text: '', link: '' }
                },
                experiments: [],
                entries: [],
                custom_image: ''
            };
        case 'prompts':
            return {
                enable_auto: true,
                section_title: '',
                section_subtitle: '',
                max_items: 6,
                sort: 'popular',
                experiments: [],
                featured_items: []
            };
        case 'shop':
            return {
                enable_auto: true,
                section_title: '',
                section_subtitle: '',
                max_items: 6,
                category: 'all',
                sort: 'popular',
                experiments: [],
                custom_items: []
            };
        case 'gongyi':
            return {
                enable_auto: false,
                section_tag: 'API中转',
                brand_name: '核心秘钥',
                brand_name_en: 'Father Key',
                brand_subtitle: 'Subscription to API Conversion Platform',
                cta_text: '进入控制台',
                cta_link: HOMEPAGE_GONGYI_TARGET_URL,
                highlight_items: ['订阅转 API', '会话保持', '按量计费'],
                feature_1_title: '一键接入',
                feature_1_description: '获取一个 API 密钥，即可调用所有已接入的 AI 模型，无需分别申请。',
                feature_2_title: '稳定可靠',
                feature_2_description: '智能调度多个上游账号，自动切换和负载均衡，告别频繁报错。',
                feature_3_title: '用多少付多少',
                feature_3_description: '按实际使用量计费，支持设置额度上限，团队用量一目了然。',
                show_model_section: true,
                model_items: [
                    { id: 'claude', label: 'Claude' },
                    { id: 'gpt', label: 'GPT' },
                    { id: 'gemini', label: 'Gemini' },
                    { id: 'antigravity', label: 'Antigravity' },
                    { id: 'more', label: '更多' }
                ]
            };
        case 'verify':
            return {
                enable_auto: false,
                section_title: '',
                section_subtitle: '',
                preview_mode: 'dynamic',
                screenshot_path: '',
                features: [],
                value_props: [],
                supported_models: [],
                cta_text: '',
                experiments: [],
                cta_link: '',
                risk_notice: '',
                demo_title: 'Google One',
                demo_subtitle: '获取 1年 pro 权限的使用权限',
                demo_email: 'preview.account@gmail.com',
                demo_totp: '3r6cu37xch4ej6d5',
                demo_success_link: 'https://services.sheerid.com/verify/zaoyoe-demo?verificationId=GO-8K21',
                demo_quota: '0.5 提 / 全 1',
                demo_balance: '7.6',
                demo_cost_points: 10
            };
        case 'guestbook':
            return {
                enable_auto: true,
                section_title: '',
                section_subtitle: '',
                max_items: 6,
                experiments: [],
                featured_items: [],
                fallback_items: []
            };
        case 'ticker':
            return {
                enable_auto: false,
                speed: 30,
                shop_scroll_speed: 30,
                enable_prompts: true,
                enable_products: true,
                prompt_tags: [],
                product_categories: [],
                activity_keywords: [],
                custom_items_top: [],
                custom_items_bottom: []
            };
        default:
            return {};
    }
}

function normalizeHomepageContent(section, content = {}) {
    const normalizedSection = normalizeHomepageSection(section);
    const source = (content && typeof content === 'object' && !Array.isArray(content)) ? content : {};
    const next = buildEmptyHomepageSectionContent(normalizedSection);

    switch (normalizedSection) {
        case 'hero':
            next.enable_auto = sanitizeBoolean(source.enable_auto, false);
            next.title = sanitizeText(source.title, '', 120);
            next.subtitle = sanitizeText(source.subtitle, '', 240);
            next.custom_image = sanitizeUrl(source.custom_image, '', 2048);
            next.cta = normalizeHomepageHeroCtaConfig(source.cta) || next.cta;
            next.experiments = normalizeHomepageSectionExperiments(normalizedSection, source.experiments);
            next.entries = normalizeHomepageHeroEntries(source.entries);
            preserveTranslatedPair(next, source, 'title', 120);
            preserveTranslatedPair(next, source, 'subtitle', 240);
            if (!next.custom_image) delete next.custom_image;
            if (!next.experiments.length) delete next.experiments;
            if (!next.entries.length) delete next.entries;
            if (!normalizeHomepageHeroCtaConfig(source.cta)) {
                delete next.cta;
            }
            return next;
        case 'prompts':
            next.enable_auto = sanitizeBoolean(source.enable_auto, true);
            next.section_title = sanitizeText(source.section_title, '', 120);
            next.section_subtitle = sanitizeText(source.section_subtitle, '', 240);
            next.max_items = sanitizeInteger(source.max_items, { fallback: 6, min: 1, max: 24 });
            next.sort = HOMEPAGE_SORT_VALUES.has(String(source.sort || '').trim()) ? String(source.sort).trim() : 'popular';
            next.experiments = normalizeHomepageSectionExperiments(normalizedSection, source.experiments);
            next.featured_items = normalizeHomepageFeaturedPromptItems(source.featured_items);
            preserveTranslatedPair(next, source, 'section_title', 120);
            preserveTranslatedPair(next, source, 'section_subtitle', 240);
            if (!next.experiments.length) delete next.experiments;
            if (!next.featured_items.length) delete next.featured_items;
            return next;
        case 'shop':
            next.enable_auto = sanitizeBoolean(source.enable_auto, true);
            next.section_title = sanitizeText(source.section_title, '', 120);
            next.section_subtitle = sanitizeText(source.section_subtitle, '', 240);
            next.max_items = sanitizeInteger(source.max_items, { fallback: 6, min: 1, max: 24 });
            next.category = sanitizeText(source.category, 'all', 80) || 'all';
            next.sort = HOMEPAGE_SORT_VALUES.has(String(source.sort || '').trim()) ? String(source.sort).trim() : 'popular';
            next.experiments = normalizeHomepageSectionExperiments(normalizedSection, source.experiments);
            next.custom_items = normalizeHomepageShopCustomItems(source.custom_items);
            preserveTranslatedPair(next, source, 'section_title', 120);
            preserveTranslatedPair(next, source, 'section_subtitle', 240);
            if (!next.experiments.length) delete next.experiments;
            if (!next.custom_items.length) delete next.custom_items;
            return next;
        case 'gongyi':
            next.enable_auto = sanitizeBoolean(source.enable_auto, false);
            next.section_tag = Object.prototype.hasOwnProperty.call(source, 'section_tag') ? sanitizeText(source.section_tag, '', 40) : next.section_tag;
            next.brand_name = Object.prototype.hasOwnProperty.call(source, 'brand_name') ? sanitizeText(source.brand_name, '', 80) : next.brand_name;
            next.brand_subtitle = Object.prototype.hasOwnProperty.call(source, 'brand_subtitle') ? sanitizeText(source.brand_subtitle, '', 240) : next.brand_subtitle;
            next.cta_text = Object.prototype.hasOwnProperty.call(source, 'cta_text') ? sanitizeText(source.cta_text, '', 48) : next.cta_text;
            next.cta_link = Object.prototype.hasOwnProperty.call(source, 'cta_link') ? normalizeHomepageGongyiUrl(sanitizeUrl(source.cta_link, '', 1024)) : next.cta_link;
            next.highlight_items = Object.prototype.hasOwnProperty.call(source, 'highlight_items')
                ? normalizeStringList(source.highlight_items, { maxItems: 6, maxLength: 48 })
                : next.highlight_items;
            next.feature_1_title = Object.prototype.hasOwnProperty.call(source, 'feature_1_title') ? sanitizeText(source.feature_1_title, '', 80) : next.feature_1_title;
            next.feature_1_description = Object.prototype.hasOwnProperty.call(source, 'feature_1_description') ? sanitizeText(source.feature_1_description, '', 240) : next.feature_1_description;
            next.feature_2_title = Object.prototype.hasOwnProperty.call(source, 'feature_2_title') ? sanitizeText(source.feature_2_title, '', 80) : next.feature_2_title;
            next.feature_2_description = Object.prototype.hasOwnProperty.call(source, 'feature_2_description') ? sanitizeText(source.feature_2_description, '', 240) : next.feature_2_description;
            next.feature_3_title = Object.prototype.hasOwnProperty.call(source, 'feature_3_title') ? sanitizeText(source.feature_3_title, '', 80) : next.feature_3_title;
            next.feature_3_description = Object.prototype.hasOwnProperty.call(source, 'feature_3_description') ? sanitizeText(source.feature_3_description, '', 240) : next.feature_3_description;
            next.show_model_section = sanitizeBoolean(source.show_model_section, next.show_model_section !== false);
            next.model_items = Object.prototype.hasOwnProperty.call(source, 'model_items')
                ? normalizeHomepageGongyiModelItems(source.model_items)
                : next.model_items;
            preserveTranslatedPair(next, source, 'section_tag', 40);
            preserveTranslatedPair(next, source, 'brand_name', 80);
            preserveTranslatedPair(next, source, 'brand_subtitle', 240);
            preserveTranslatedPair(next, source, 'cta_text', 48);
            preserveTranslatedPair(next, source, 'feature_1_title', 80);
            preserveTranslatedPair(next, source, 'feature_1_description', 240);
            preserveTranslatedPair(next, source, 'feature_2_title', 80);
            preserveTranslatedPair(next, source, 'feature_2_description', 240);
            preserveTranslatedPair(next, source, 'feature_3_title', 80);
            preserveTranslatedPair(next, source, 'feature_3_description', 240);
            if (!next.section_tag) delete next.section_tag;
            if (!next.brand_name) delete next.brand_name;
            if (!next.brand_subtitle) delete next.brand_subtitle;
            if (!next.cta_text) delete next.cta_text;
            if (!next.cta_link) delete next.cta_link;
            if (!next.highlight_items.length) delete next.highlight_items;
            if (!next.feature_1_title) delete next.feature_1_title;
            if (!next.feature_1_description) delete next.feature_1_description;
            if (!next.feature_2_title) delete next.feature_2_title;
            if (!next.feature_2_description) delete next.feature_2_description;
            if (!next.feature_3_title) delete next.feature_3_title;
            if (!next.feature_3_description) delete next.feature_3_description;
            if (!next.model_items.length) delete next.model_items;
            return next;
        case 'verify':
            next.enable_auto = sanitizeBoolean(source.enable_auto, false);
            next.section_title = normalizeHomepageVerifyDisplayLabel(source.section_title);
            next.section_subtitle = sanitizeText(source.section_subtitle, '', 240);
            next.preview_mode = sanitizeText(source.preview_mode, next.preview_mode, 20) === 'image' ? 'image' : 'dynamic';
            next.screenshot_path = sanitizeUrl(source.screenshot_path, '', 2048);
            next.features = normalizeStringList(source.features, { maxItems: 8, maxLength: 60 });
            next.value_props = normalizeStringList(source.value_props, { maxItems: 8, maxLength: 80 });
            next.supported_models = normalizeStringList(source.supported_models, { maxItems: 8, maxLength: 80 });
            next.cta_text = sanitizeText(source.cta_text, '', 48);
            next.experiments = normalizeHomepageSectionExperiments(normalizedSection, source.experiments);
            next.cta_link = sanitizeUrl(source.cta_link, '', 1024);
            next.risk_notice = sanitizeText(source.risk_notice, '', 240);
            next.demo_title = Object.prototype.hasOwnProperty.call(source, 'demo_title') ? sanitizeText(source.demo_title, '', 80) : next.demo_title;
            next.demo_subtitle = Object.prototype.hasOwnProperty.call(source, 'demo_subtitle') ? sanitizeText(source.demo_subtitle, '', 160) : next.demo_subtitle;
            next.demo_email = Object.prototype.hasOwnProperty.call(source, 'demo_email') ? sanitizeText(source.demo_email, '', 120) : next.demo_email;
            next.demo_totp = Object.prototype.hasOwnProperty.call(source, 'demo_totp') ? sanitizeText(source.demo_totp, '', 80) : next.demo_totp;
            next.demo_success_link = Object.prototype.hasOwnProperty.call(source, 'demo_success_link') ? sanitizeUrl(source.demo_success_link, '', 1024) : next.demo_success_link;
            next.demo_quota = Object.prototype.hasOwnProperty.call(source, 'demo_quota') ? sanitizeText(source.demo_quota, '', 48) : next.demo_quota;
            next.demo_balance = Object.prototype.hasOwnProperty.call(source, 'demo_balance') ? sanitizeText(source.demo_balance, '', 48) : next.demo_balance;
            next.demo_cost_points = sanitizeInteger(source.demo_cost_points, { fallback: next.demo_cost_points, min: 1, max: 999 });
            preserveTranslatedPair(next, source, 'section_title', 120);
            preserveTranslatedPair(next, source, 'section_subtitle', 240);
            if (!next.experiments.length) delete next.experiments;
            if (!next.screenshot_path) delete next.screenshot_path;
            if (!next.features.length) delete next.features;
            if (!next.value_props.length) delete next.value_props;
            if (!next.supported_models.length) delete next.supported_models;
            if (!next.cta_text) delete next.cta_text;
            if (!next.cta_link) delete next.cta_link;
            if (!next.risk_notice) delete next.risk_notice;
            if (!next.demo_title) delete next.demo_title;
            if (!next.demo_subtitle) delete next.demo_subtitle;
            if (!next.demo_email) delete next.demo_email;
            if (!next.demo_totp) delete next.demo_totp;
            if (!next.demo_success_link) delete next.demo_success_link;
            if (!next.demo_quota) delete next.demo_quota;
            if (!next.demo_balance) delete next.demo_balance;
            return next;
        case 'guestbook':
            next.enable_auto = sanitizeBoolean(source.enable_auto, true);
            next.section_title = sanitizeText(source.section_title, '', 120);
            next.section_subtitle = sanitizeText(source.section_subtitle, '', 240);
            next.max_items = sanitizeInteger(source.max_items, { fallback: 6, min: 1, max: 12 });
            next.experiments = normalizeHomepageSectionExperiments(normalizedSection, source.experiments);
            next.featured_items = normalizeHomepageGuestbookFeaturedItems(source.featured_items);
            next.fallback_items = normalizeHomepageGuestbookFallbackItems(source.fallback_items);
            preserveTranslatedPair(next, source, 'section_title', 120);
            preserveTranslatedPair(next, source, 'section_subtitle', 240);
            if (!next.experiments.length) delete next.experiments;
            if (!next.featured_items.length) delete next.featured_items;
            if (!next.fallback_items.length) delete next.fallback_items;
            return next;
        case 'ticker':
            next.enable_auto = sanitizeBoolean(source.enable_auto, false);
            next.speed = sanitizeInteger(source.speed, { fallback: 30, min: 1, max: 100 });
            next.shop_scroll_speed = sanitizeInteger(source.shop_scroll_speed, { fallback: next.speed, min: 1, max: 100 });
            next.enable_prompts = sanitizeBoolean(source.enable_prompts, true);
            next.enable_products = sanitizeBoolean(source.enable_products, true);
            next.prompt_tags = normalizeStringList(source.prompt_tags, { maxItems: 24, maxLength: 80 });
            next.product_categories = normalizeStringList(source.product_categories, { maxItems: 24, maxLength: 80 });
            next.activity_keywords = normalizeStringList(source.activity_keywords, { maxItems: 24, maxLength: 80 });
            next.custom_items_top = normalizeStringList(source.custom_items_top, { maxItems: 40, maxLength: 80 });
            next.custom_items_bottom = normalizeStringList(source.custom_items_bottom, { maxItems: 40, maxLength: 80 });
            if (!next.prompt_tags.length) delete next.prompt_tags;
            if (!next.product_categories.length) delete next.product_categories;
            if (!next.activity_keywords.length) delete next.activity_keywords;
            if (!next.custom_items_top.length) delete next.custom_items_top;
            if (!next.custom_items_bottom.length) delete next.custom_items_bottom;
            return next;
        default:
            return {};
    }
}

function buildHomepageRowRecord(row = {}) {
    const section = normalizeHomepageSection(row.section);
    const site = normalizeHomepageSite(row.site);
    return {
        id: row.id || null,
        site,
        section,
        content: normalizeHomepageContent(section, row.content),
        is_visible: row.is_visible !== false,
        display_order: sanitizeInteger(row.display_order, { fallback: HOMEPAGE_SECTION_ORDER.indexOf(section) + 1, min: 0, max: 999 }),
        updated_at: row.updated_at || null
    };
}

function mapHomepageRowsBySection(rows = []) {
    return (Array.isArray(rows) ? rows : []).reduce((accumulator, row) => {
        const record = buildHomepageRowRecord(row);
        if (!record.section) {
            return accumulator;
        }
        accumulator[record.section] = record;
        return accumulator;
    }, {});
}

function buildHomepageRowsFromSectionMap(site, sectionMap = {}, baseRows = []) {
    const normalizedSite = normalizeHomepageSite(site);
    const baseMap = mapHomepageRowsBySection(baseRows);

    return HOMEPAGE_SECTION_ORDER.map((section, index) => {
        const baseRow = baseMap[section] || {};
        const source = sectionMap?.[section] || {};
        return {
            id: source.id || baseRow.id || null,
            site: normalizedSite,
            section,
            content: normalizeHomepageContent(section, source.content || baseRow.content),
            is_visible: source.is_visible !== undefined ? source.is_visible !== false : (baseRow.is_visible !== false),
            display_order: sanitizeInteger(
                source.display_order !== undefined ? source.display_order : baseRow.display_order,
                { fallback: index + 1, min: 0, max: 999 }
            ),
            updated_at: source.updated_at || baseRow.updated_at || null
        };
    });
}

function mergeHomepageDraftRows(publishedRows = [], draftSections = {}) {
    return buildHomepageRowsFromSectionMap(
        normalizeHomepageSite(publishedRows[0]?.site),
        draftSections,
        publishedRows
    );
}

function validateHomepageRow(section, row = {}, options = {}) {
    const normalizedSection = normalizeHomepageSection(section);
    const normalizedRow = buildHomepageRowRecord({
        ...row,
        section: normalizedSection,
        site: normalizeHomepageSite(row.site)
    });
    const errors = [];
    const warnings = [];
    const content = normalizedRow.content || {};
    const promptPoolIds = new Set(Array.isArray(options.promptPoolIds) ? options.promptPoolIds : []);
    const validShopCategories = new Set(Array.isArray(options.shopCategories) ? options.shopCategories : []);
    const productCatalogById = new Map(
        (Array.isArray(options.shopProducts) ? options.shopProducts : [])
            .map((item) => [String(item?.id || '').trim(), item])
            .filter(([id]) => Boolean(id))
    );
    const guestbookMessageIds = new Set(
        (Array.isArray(options.guestbookMessages) ? options.guestbookMessages : [])
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean)
    );

    if (!normalizedSection) {
        errors.push('Unsupported homepage section');
        return { errors, warnings, row: normalizedRow };
    }

    if (normalizedRow.display_order < 0) {
        errors.push('display_order must be >= 0');
    }

    switch (normalizedSection) {
        case 'hero':
            if (!content.title) warnings.push('Hero 主标题为空，前台将回退到默认文案');
            if (!content.subtitle) warnings.push('Hero 副标题为空，前台将回退到默认文案');
            if (content.custom_image && !/^https?:|^\//.test(content.custom_image)) {
                warnings.push('Hero 背景图路径不是标准 URL 或绝对路径');
            }
            if (!Array.isArray(content.entries) || !content.entries.length) {
                warnings.push('Hero 入口卡片为空，首屏导流能力会回退到默认入口');
            }
            if (content.entries?.some((entry) => entry.enabled === false)) {
                warnings.push('Hero 入口卡片中存在已禁用条目，发布前请确认是否仍需要保留');
            }
            if (!content.title_en && !content.title_zh) {
                warnings.push('Hero 标题未补齐双语字段');
            }
            break;
        case 'prompts':
            if (!content.section_title) warnings.push('Prompt 分区标题为空');
            if (content.enable_auto === false && (!Array.isArray(content.featured_items) || !content.featured_items.length)) {
                errors.push('关闭自动聚合时，至少需要 1 条首页精选 Prompt');
            }
            if (Array.isArray(content.featured_items) && content.featured_items.length > 0 && promptPoolIds.size > 0) {
                const missingIds = content.featured_items
                    .map((item) => String(item?.id || '').trim())
                    .filter((id) => id && !promptPoolIds.has(id));
                if (missingIds.length > 0) {
                    warnings.push(`有 ${missingIds.length} 条精选 Prompt 当前在 Gallery 数据集中不存在`);
                }
            }
            if (!content.section_title_en && !content.section_title_zh) {
                warnings.push('Prompt 分区标题未补齐双语字段');
            }
            break;
        case 'shop': {
            if (!content.section_title) warnings.push('Shop 分区标题为空');
            if (content.category && content.category !== 'all' && validShopCategories.size > 0 && !validShopCategories.has(content.category)) {
                warnings.push('Shop 首页分类不在当前分类列表中');
            }
            if (content.enable_auto === false && (!Array.isArray(content.custom_items) || !content.custom_items.length)) {
                errors.push('关闭自动聚合时，至少需要 1 条首页精选商品');
            }

            const selectedProducts = Array.isArray(content.custom_items) ? content.custom_items : [];
            if (selectedProducts.length > 0 && productCatalogById.size > 0) {
                const inactiveCount = selectedProducts.filter((item) => {
                    const current = productCatalogById.get(String(item?.id || '').trim());
                    return current && current.is_active === false;
                }).length;
                const emptyStockCount = selectedProducts.filter((item) => {
                    const current = productCatalogById.get(String(item?.id || '').trim());
                    return current && Number(current.stock_count || 0) <= 0;
                }).length;
                const missingCount = selectedProducts.filter((item) => !productCatalogById.has(String(item?.id || '').trim())).length;

                if (inactiveCount > 0) warnings.push(`精选商品中有 ${inactiveCount} 个已下架商品`);
                if (emptyStockCount > 0) warnings.push(`精选商品中有 ${emptyStockCount} 个库存为 0 的商品`);
                if (missingCount > 0) warnings.push(`精选商品中有 ${missingCount} 个商品已不在商品目录中`);
            }
            break;
        }
        case 'gongyi':
            if (!content.brand_name) warnings.push('API中转品牌名为空');
            if (!content.brand_subtitle) warnings.push('API中转副标题为空');
            if (!content.cta_text || !content.cta_link) warnings.push('API中转 CTA 文案或链接未配置完整');
            if (!Array.isArray(content.highlight_items) || !content.highlight_items.length) {
                warnings.push('API中转能力标签为空');
            }
            if (!content.feature_1_title && !content.feature_2_title && !content.feature_3_title) {
                warnings.push('API中转卖点卡片标题为空');
            }
            if (content.show_model_section !== false && (!Array.isArray(content.model_items) || !content.model_items.some((item) => item?.enabled !== false))) {
                warnings.push('API中转模型标签为空');
            }
            break;
        case 'verify':
            if (!content.section_title) warnings.push('Gemini Pro 标题为空');
            if (content.preview_mode === 'image' && !content.screenshot_path) warnings.push('Gemini Pro 预览截图为空');
            if (content.screenshot_path && /^data:image\//.test(content.screenshot_path)) {
                warnings.push('Gemini Pro 预览截图不能再使用 base64 数据，请上传到 R2/CDN');
            }
            if (!Array.isArray(content.features) || !content.features.length) {
                warnings.push('Gemini Pro 特性标签为空');
            }
            if (!Array.isArray(content.supported_models) || !content.supported_models.length) {
                warnings.push('Gemini Pro 支持模型说明为空');
            }
            if (!content.cta_text || !content.cta_link) {
                warnings.push('Gemini Pro CTA 文案或链接未配置完整');
            }
            if (!content.risk_notice) {
                warnings.push('Gemini Pro 风险提示为空');
            }
            break;
        case 'guestbook': {
            if (!content.section_title) warnings.push('Guestbook 标题为空');
            const featuredItems = Array.isArray(content.featured_items) ? content.featured_items : [];
            const fallbackItems = Array.isArray(content.fallback_items) ? content.fallback_items : [];
            if (content.enable_auto === false && featuredItems.length === 0 && fallbackItems.length === 0) {
                errors.push('Guestbook 关闭自动聚合时，至少需要 1 条精选留言或兜底卡片');
            }
            if (featuredItems.length > 0 && guestbookMessageIds.size > 0) {
                const missingIds = featuredItems
                    .map((item) => String(item?.id || '').trim())
                    .filter((id) => id && !guestbookMessageIds.has(id));
                if (missingIds.length > 0) {
                    warnings.push(`Guestbook 精选中有 ${missingIds.length} 条留言已不在当前留言池中`);
                }
            }
            if (fallbackItems.length === 0) {
                warnings.push('Guestbook 还没有配置运营兜底卡片');
            }
            break;
        }
        case 'ticker':
            if (!content.enable_prompts && !content.enable_products
                && (!Array.isArray(content.custom_items_top) || !content.custom_items_top.length)
                && (!Array.isArray(content.custom_items_bottom) || !content.custom_items_bottom.length)
                && (!Array.isArray(content.prompt_tags) || !content.prompt_tags.length)
                && (!Array.isArray(content.product_categories) || !content.product_categories.length)
                && (!Array.isArray(content.activity_keywords) || !content.activity_keywords.length)) {
                warnings.push('Ticker 当前没有任何启用的内容源');
            }
            if (Array.isArray(content.product_categories) && validShopCategories.size > 0) {
                const invalidCategories = content.product_categories.filter((category) => !validShopCategories.has(category));
                if (invalidCategories.length > 0) {
                    warnings.push(`Ticker 商品分类里有 ${invalidCategories.length} 个分类不在当前分类列表中`);
                }
            }
            break;
        default:
            break;
    }

    return {
        errors,
        warnings,
        row: normalizedRow
    };
}

function buildHomepageReleasePayload(rows = []) {
    const normalizedRows = Array.isArray(rows) ? rows.map((row) => buildHomepageRowRecord(row)) : [];
    const site = normalizeHomepageSite(normalizedRows[0]?.site);
    const sections = {};
    normalizedRows.forEach((row) => {
        if (!row.section) return;
        sections[row.section] = {
            content: normalizeHomepageContent(row.section, row.content),
            is_visible: row.is_visible !== false,
            display_order: row.display_order
        };
    });

    return {
        schema_version: HOMEPAGE_EDITOR_SCHEMA_VERSION,
        site,
        sections
    };
}

function parseHomepageReleasePayload(payload = {}, site, baseRows = []) {
    const sections = payload?.sections && typeof payload.sections === 'object' && !Array.isArray(payload.sections)
        ? payload.sections
        : {};
    return buildHomepageRowsFromSectionMap(site || payload.site, sections, baseRows);
}

module.exports = {
    HOMEPAGE_EDITOR_SCHEMA_VERSION,
    HOMEPAGE_SECTION_ORDER,
    HOMEPAGE_SECTION_SET,
    HOMEPAGE_SITE_VALUES,
    normalizeHomepageSite,
    normalizeHomepageSection,
    buildEmptyHomepageSectionContent,
    normalizeHomepageGongyiUrl,
    normalizeHomepageContent,
    normalizeHomepageFeaturedPromptItems,
    buildHomepageRowRecord,
    mapHomepageRowsBySection,
    buildHomepageRowsFromSectionMap,
    mergeHomepageDraftRows,
    validateHomepageRow,
    buildHomepageReleasePayload,
    parseHomepageReleasePayload
};
