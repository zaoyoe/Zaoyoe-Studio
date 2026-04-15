const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    normalizeHomepageSite,
    normalizeHomepageContent,
    buildHomepageRowRecord,
    buildHomepageRowsFromSectionMap,
    mapHomepageRowsBySection,
    mergeHomepageDraftRows,
    validateHomepageRow,
    buildHomepageReleasePayload,
    parseHomepageReleasePayload
} = require('./_shared');

const HOMEPAGE_P1_MIGRATION_HINT = 'Homepage P1 schedule/template migration is missing. Please run 20260411_homepage_p1_schedule_templates_and_runtime_rpc.sql first.';
const HOMEPAGE_ANALYTICS_EVENT_NAMES = Object.freeze([
    'homepage_section_impression',
    'homepage_experiment_impression',
    'homepage_entry_click',
    'homepage_prompt_click',
    'homepage_shop_click',
    'homepage_gongyi_click',
    'homepage_verify_impression',
    'homepage_verify_click',
    'homepage_guestbook_click',
    'homepage_ticker_click',
    'prompt_view',
    'unlock_success',
    'verify_submit',
    'verify_success',
    'guestbook_post'
]);
const HOMEPAGE_THEME_TEMPLATE_TYPES = new Set(['theme_pack', 'new-arrival', 'campaign', 'intl-launch', 'community']);
const HOMEPAGE_SECTION_KEYS = Object.freeze(['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker']);
const HOMEPAGE_THEME_PACK_SECTION_KEYS = Object.freeze(['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker']);
const HOMEPAGE_EXPERIMENT_FIELD_LABELS = Object.freeze({
    hero: Object.freeze({
        title: 'Hero 标题',
        subtitle: 'Hero 副标题'
    }),
    prompts: Object.freeze({
        featured_items: 'Prompt 精选清单'
    }),
    shop: Object.freeze({
        custom_items: '商城精选清单'
    }),
    verify: Object.freeze({
        cta_text: 'Verify CTA'
    }),
    guestbook: Object.freeze({
        featured_items: '留言精选清单'
    })
});

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function sanitizeText(value, maxLength = 240) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function getHomepagePrimaryLanguage(site) {
    return normalizeHomepageSite(site) === 'intl' ? 'en' : 'zh';
}

function cloneHomepageJson(value) {
    if (value === null || value === undefined) {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

function parseDelimitedExperimentIds(value) {
    return String(value || '')
        .split(/[\n,]+/)
        .map((item) => sanitizeText(item, 160))
        .filter(Boolean);
}

function parseJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isMissingHomepageP1Table(error) {
    return Boolean(error?.message && /homepage_site_templates|homepage_site_schedules|relation .* does not exist/i.test(error.message));
}

async function loadPublishedHomepageRows(supabase, site) {
    const { data, error } = await supabase
        .from('homepage_config')
        .select('id, site, section, content, is_visible, display_order, updated_at')
        .eq('site', normalizeHomepageSite(site))
        .order('display_order', { ascending: true });

    if (error) {
        throw error;
    }

    const rows = Array.isArray(data)
        ? data.map((row) => buildHomepageRowRecord(row)).filter((row) => row.section)
        : [];

    return buildHomepageRowsFromSectionMap(site, {}, rows);
}

async function loadHomepageDraft(supabase, site) {
    const query = supabase
        .from('homepage_site_drafts')
        .select('site, sections, updated_at, updated_by')
        .eq('site', normalizeHomepageSite(site));
    const { data, error } = await (typeof query.maybeSingle === 'function'
        ? query.maybeSingle()
        : query.single());

    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        throw error;
    }

    return data || null;
}

async function upsertHomepageDraft(supabase, site, sections, userId) {
    const payload = {
        site: normalizeHomepageSite(site),
        sections,
        updated_by: userId || null,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('homepage_site_drafts')
        .upsert(payload, { onConflict: 'site' })
        .select('site, sections, updated_at, updated_by')
        .single();

    if (error) {
        throw error;
    }

    return data || payload;
}

async function loadHomepageWorkingState(supabase, site) {
    const publishedRows = await loadPublishedHomepageRows(supabase, site);
    const draft = await loadHomepageDraft(supabase, site);
    const currentRows = draft?.sections
        ? mergeHomepageDraftRows(publishedRows, draft.sections)
        : buildHomepageRowsFromSectionMap(site, {}, publishedRows);

    return {
        draft,
        publishedRows,
        currentRows,
        rowMap: mapHomepageRowsBySection(currentRows)
    };
}

function buildDraftSectionsFromHomepageRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).reduce((accumulator, row) => {
        if (!row?.section) {
            return accumulator;
        }
        accumulator[row.section] = {
            content: normalizeHomepageContent(row.section, row.content),
            is_visible: row.is_visible !== false,
            display_order: Number(row.display_order || 0) || 0
        };
        return accumulator;
    }, {});
}

async function loadHomepageValidationContext(supabase, site) {
    const normalizedSite = normalizeHomepageSite(site);
    const [
        shopCategories,
        shopProducts,
        guestbookMessages,
        promptPoolIds
    ] = await Promise.all([
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('shop_categories')
                    .select('name')
                    .order('sort_order', { ascending: true });
                if (error) return [];
                return Array.isArray(data)
                    ? data.map((item) => String(item?.name || '').trim()).filter(Boolean)
                    : [];
            } catch (_error) {
                return [];
            }
        })(),
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('shop_products')
                    .select('id, is_active, stock_count, category, name')
                    .order('display_order', { ascending: false });
                if (error) return [];
                return Array.isArray(data) ? data : [];
            } catch (_error) {
                return [];
            }
        })(),
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('guestbook_messages')
                    .select('id')
                    .eq('site', normalizedSite)
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (error) return [];
                return Array.isArray(data) ? data : [];
            } catch (_error) {
                return [];
            }
        })(),
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('prompts')
                    .select('id')
                    .order('updated_at', { ascending: false })
                    .limit(500);
                if (error) return [];
                return Array.isArray(data)
                    ? data.map((item) => String(item?.id || '').trim()).filter(Boolean)
                    : [];
            } catch (_error) {
                return [];
            }
        })()
    ]);

    return {
        shopCategories,
        shopProducts,
        guestbookMessages,
        promptPoolIds
    };
}

async function buildHomepageHealth(supabase, site, rows = []) {
    const validationContext = await loadHomepageValidationContext(supabase, site);
    const sections = {};
    const errors = [];
    const warnings = [];

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const result = validateHomepageRow(row.section, row, validationContext);
        sections[row.section] = {
            errors: result.errors,
            warnings: result.warnings,
            row: result.row
        };

        result.errors.forEach((message) => {
            errors.push({
                section: row.section,
                message
            });
        });
        result.warnings.forEach((message) => {
            warnings.push({
                section: row.section,
                message
            });
        });
    });

    return {
        status: errors.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'healthy'),
        error_count: errors.length,
        warning_count: warnings.length,
        errors,
        warnings,
        sections
    };
}

async function loadHomepageTemplates(supabase, site) {
    try {
        let query = supabase
            .from('homepage_site_templates')
            .select('id, site, name, description, template_type, payload, created_at, updated_at, created_by, source_release_id')
            .eq('site', normalizeHomepageSite(site))
            .order('updated_at', { ascending: false });

        const { data, error } = await query;
        if (error) {
            if (isMissingHomepageP1Table(error)) {
                return { rows: [], available: false, message: HOMEPAGE_P1_MIGRATION_HINT };
            }
            throw error;
        }

        return {
            rows: Array.isArray(data) ? data : [],
            available: true,
            message: ''
        };
    } catch (error) {
        if (isMissingHomepageP1Table(error)) {
            return { rows: [], available: false, message: HOMEPAGE_P1_MIGRATION_HINT };
        }
        throw error;
    }
}

async function loadHomepageSchedules(supabase, site) {
    try {
        let query = supabase
            .from('homepage_site_schedules')
            .select('id, site, name, note, payload, starts_at, ends_at, status, template_id, created_at, updated_at, created_by')
            .eq('site', normalizeHomepageSite(site))
            .order('starts_at', { ascending: true });

        const { data, error } = await query;
        if (error) {
            if (isMissingHomepageP1Table(error)) {
                return { rows: [], available: false, message: HOMEPAGE_P1_MIGRATION_HINT };
            }
            throw error;
        }

        return {
            rows: Array.isArray(data) ? data : [],
            available: true,
            message: ''
        };
    } catch (error) {
        if (isMissingHomepageP1Table(error)) {
            return { rows: [], available: false, message: HOMEPAGE_P1_MIGRATION_HINT };
        }
        throw error;
    }
}

function normalizePromptAdminOpsData(value = {}) {
    const source = parseJsonObject(value);
    const normalizedStatus = sanitizeText(source.status, 80).toLowerCase();
    return {
        status: normalizedStatus,
        note: sanitizeText(source.note, 240),
        recommended_by: sanitizeText(source.recommended_by || source.recommendedBy, 120)
    };
}

function getPromptAdminOpsData(prompt = {}) {
    const aiTags = parseJsonObject(prompt.ai_tags || prompt.aiTags);
    return normalizePromptAdminOpsData(aiTags.admin || aiTags.ops || {});
}

function extractEventData(record) {
    return parseJsonObject(record?.event_data);
}

function extractEventMetadata(record) {
    return parseJsonObject(extractEventData(record).metadata);
}

function extractEventEntityId(record) {
    const eventData = extractEventData(record);
    return sanitizeText(
        eventData.entity_id
        || eventData.entityId
        || eventData.target_id
        || extractEventMetadata(record).prompt_id
        || extractEventMetadata(record).product_id
        || extractEventMetadata(record).item_id,
        160
    );
}

function buildEmptyModuleAnalytics() {
    return {
        impressions_7d: 0,
        clicks_7d: 0,
        conversions_7d: 0,
        interactions_7d: 0,
        impressions_30d: 0,
        clicks_30d: 0,
        conversions_30d: 0,
        interactions_30d: 0
    };
}

function buildEmptyHomepageAnalyticsPayload() {
    return {
        sections: HOMEPAGE_SECTION_KEYS.reduce((accumulator, section) => {
            accumulator[section] = buildEmptyModuleAnalytics();
            return accumulator;
        }, {}),
        items: {
            hero_entries: [],
            prompts: [],
            shop: [],
            ticker: []
        }
    };
}

function incrementHomepageModuleMetric(analytics, section, metric, windowKey) {
    if (!analytics.sections[section]) {
        analytics.sections[section] = buildEmptyModuleAnalytics();
    }
    analytics.sections[section][`${metric}_${windowKey}`] = Number(analytics.sections[section][`${metric}_${windowKey}`] || 0) + 1;
}

function incrementHomepageItemMetric(itemMap, groupKey, entityId, title, metric, windowKey) {
    if (!entityId) {
        return;
    }
    if (!itemMap[groupKey]) {
        itemMap[groupKey] = new Map();
    }
    if (!itemMap[groupKey].has(entityId)) {
        itemMap[groupKey].set(entityId, {
            id: entityId,
            title: title || entityId,
            impressions_7d: 0,
            clicks_7d: 0,
            conversions_7d: 0,
            interactions_7d: 0,
            impressions_30d: 0,
            clicks_30d: 0,
            conversions_30d: 0,
            interactions_30d: 0
        });
    }
    const entry = itemMap[groupKey].get(entityId);
    entry.title = entry.title || title || entityId;
    entry[`${metric}_${windowKey}`] = Number(entry[`${metric}_${windowKey}`] || 0) + 1;
}

function finalizeHomepageItemMetrics(itemMap, key) {
    const map = itemMap[key];
    if (!(map instanceof Map)) {
        return [];
    }
    return Array.from(map.values())
        .sort((left, right) => {
            const rightScore = Number(right.clicks_7d || 0) + Number(right.conversions_7d || 0) * 2;
            const leftScore = Number(left.clicks_7d || 0) + Number(left.conversions_7d || 0) * 2;
            return rightScore - leftScore;
        })
        .slice(0, 12);
}

async function fetchHomepageAnalytics(supabase, site) {
    const analytics = buildEmptyHomepageAnalyticsPayload();
    const itemMap = {
        hero_entries: new Map(),
        prompts: new Map(),
        shop: new Map(),
        ticker: new Map()
    };

    try {
        const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
        const sevenDaysAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);

        const { data, error } = await supabase
            .from('user_events')
            .select('event_name, event_data, created_at, site')
            .eq('site', normalizeHomepageSite(site))
            .in('event_name', HOMEPAGE_ANALYTICS_EVENT_NAMES)
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false })
            .limit(3000);

        if (error) {
            return analytics;
        }

        (Array.isArray(data) ? data : []).forEach((record) => {
            const eventName = sanitizeText(record?.event_name, 120);
            const metadata = extractEventMetadata(record);
            const eventData = extractEventData(record);
            const entityId = extractEventEntityId(record);
            const createdAtMs = Date.parse(record?.created_at || 0);
            const windowKeys = Number.isFinite(createdAtMs) && createdAtMs >= sevenDaysAgoMs ? ['30d', '7d'] : ['30d'];

            windowKeys.forEach((windowKey) => {
                switch (eventName) {
                    case 'homepage_section_impression':
                        incrementHomepageModuleMetric(analytics, sanitizeText(entityId || metadata.section, 80), 'impressions', windowKey);
                        break;
                    case 'homepage_entry_click':
                        incrementHomepageModuleMetric(analytics, 'hero', 'clicks', windowKey);
                        incrementHomepageItemMetric(itemMap, 'hero_entries', entityId || sanitizeText(metadata.entry_id, 160), sanitizeText(metadata.title || metadata.entry_label, 160), 'clicks', windowKey);
                        break;
                    case 'homepage_prompt_click':
                        incrementHomepageModuleMetric(analytics, 'prompts', 'clicks', windowKey);
                        incrementHomepageItemMetric(itemMap, 'prompts', entityId, sanitizeText(metadata.title, 160), 'clicks', windowKey);
                        break;
                    case 'homepage_shop_click':
                        incrementHomepageModuleMetric(analytics, 'shop', 'clicks', windowKey);
                        incrementHomepageItemMetric(itemMap, 'shop', entityId, sanitizeText(metadata.title, 160), 'clicks', windowKey);
                        break;
                    case 'homepage_gongyi_click':
                        incrementHomepageModuleMetric(analytics, 'gongyi', 'clicks', windowKey);
                        break;
                    case 'homepage_verify_impression':
                        incrementHomepageModuleMetric(analytics, 'verify', 'impressions', windowKey);
                        break;
                    case 'homepage_verify_click':
                        incrementHomepageModuleMetric(analytics, 'verify', 'clicks', windowKey);
                        break;
                    case 'verify_submit':
                        if (sanitizeText(metadata.source, 80) === 'homepage_verify') {
                            incrementHomepageModuleMetric(analytics, 'verify', 'conversions', windowKey);
                        }
                        break;
                    case 'verify_success':
                        if (sanitizeText(metadata.source, 80) === 'homepage_verify') {
                            incrementHomepageModuleMetric(analytics, 'verify', 'interactions', windowKey);
                        }
                        break;
                    case 'homepage_guestbook_click':
                        incrementHomepageModuleMetric(analytics, 'guestbook', 'clicks', windowKey);
                        break;
                    case 'guestbook_post':
                        if (sanitizeText(metadata.source, 80) === 'homepage_guestbook') {
                            incrementHomepageModuleMetric(analytics, 'guestbook', 'conversions', windowKey);
                        }
                        break;
                    case 'homepage_ticker_click':
                        incrementHomepageModuleMetric(analytics, 'ticker', 'clicks', windowKey);
                        incrementHomepageItemMetric(itemMap, 'ticker', entityId, sanitizeText(metadata.title || metadata.label, 160), 'clicks', windowKey);
                        break;
                    default:
                        break;
                }

                if (eventName === 'homepage_section_impression' && sanitizeText(entityId || metadata.section, 80) === 'prompts') {
                    incrementHomepageModuleMetric(analytics, 'prompts', 'impressions', windowKey);
                }
                if (eventName === 'homepage_section_impression' && sanitizeText(entityId || metadata.section, 80) === 'shop') {
                    incrementHomepageModuleMetric(analytics, 'shop', 'impressions', windowKey);
                }
                if (eventName === 'homepage_section_impression' && sanitizeText(entityId || metadata.section, 80) === 'guestbook') {
                    incrementHomepageModuleMetric(analytics, 'guestbook', 'impressions', windowKey);
                }
                if (eventName === 'homepage_section_impression' && sanitizeText(entityId || metadata.section, 80) === 'ticker') {
                    incrementHomepageModuleMetric(analytics, 'ticker', 'impressions', windowKey);
                }
                if (eventName === 'homepage_section_impression' && sanitizeText(entityId || metadata.section, 80) === 'hero') {
                    incrementHomepageModuleMetric(analytics, 'hero', 'impressions', windowKey);
                }
            });
        });
    } catch (_error) {
        return analytics;
    }

    analytics.items.hero_entries = finalizeHomepageItemMetrics(itemMap, 'hero_entries');
    analytics.items.prompts = finalizeHomepageItemMetrics(itemMap, 'prompts');
    analytics.items.shop = finalizeHomepageItemMetrics(itemMap, 'shop');
    analytics.items.ticker = finalizeHomepageItemMetrics(itemMap, 'ticker');
    return analytics;
}

async function fetchHomepagePromptCandidates(supabase, site) {
    const normalizedSite = normalizeHomepageSite(site);
    const featuredSitesByPromptId = new Map();
    const candidateMetrics = new Map();

    try {
        const { data: homepageRows, error: homepageError } = await supabase
            .from('homepage_config')
            .select('site, section, content')
            .eq('section', 'prompts');

        if (!homepageError) {
            (Array.isArray(homepageRows) ? homepageRows : []).forEach((row) => {
                const siteKey = normalizeHomepageSite(row?.site);
                const featuredItems = Array.isArray(row?.content?.featured_items) ? row.content.featured_items : [];
                featuredItems.forEach((item) => {
                    const promptId = sanitizeText(item?.id, 160);
                    if (!promptId) return;
                    if (!featuredSitesByPromptId.has(promptId)) {
                        featuredSitesByPromptId.set(promptId, new Set());
                    }
                    featuredSitesByPromptId.get(promptId).add(siteKey);
                });
            });
        }
    } catch (_error) {
        // Ignore feature-state failures; homepage candidates can still render without it.
    }

    try {
        const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
        const { data: metricRows, error: metricError } = await supabase
            .from('user_events')
            .select('event_name, event_data, created_at, site')
            .eq('site', normalizedSite)
            .in('event_name', ['prompt_view', 'unlock_success', 'homepage_prompt_click'])
            .gte('created_at', sevenDaysAgo)
            .limit(3000);

        if (!metricError) {
            (Array.isArray(metricRows) ? metricRows : []).forEach((row) => {
                const promptId = extractEventEntityId(row);
                if (!promptId) {
                    return;
                }

                if (!candidateMetrics.has(promptId)) {
                    candidateMetrics.set(promptId, {
                        prompt_view_7d: 0,
                        unlock_success_7d: 0,
                        homepage_click_7d: 0
                    });
                }

                const bucket = candidateMetrics.get(promptId);
                if (row.event_name === 'prompt_view') bucket.prompt_view_7d += 1;
                if (row.event_name === 'unlock_success') bucket.unlock_success_7d += 1;
                if (row.event_name === 'homepage_prompt_click') bucket.homepage_click_7d += 1;
            });
        }
    } catch (_error) {
        // Ignore metrics failure.
    }

    try {
        const promptSelect = 'id, title, title_zh, title_en, images, tags, ai_tags, updated_at';
        const { data, error } = await supabase
            .from('prompts')
            .select(promptSelect)
            .order('updated_at', { ascending: false })
            .limit(300);

        if (error) {
            return [];
        }

        return (Array.isArray(data) ? data : [])
            .map((prompt) => {
                const ops = getPromptAdminOpsData(prompt);
                if (ops.status !== 'homepage-candidate') {
                    return null;
                }

                const promptId = sanitizeText(prompt?.id, 160);
                const featuredSites = Array.from(featuredSitesByPromptId.get(promptId) || []);
                const metrics = candidateMetrics.get(promptId) || {
                    prompt_view_7d: 0,
                    unlock_success_7d: 0,
                    homepage_click_7d: 0
                };

                return {
                    id: promptId,
                    title: sanitizeText(prompt?.title, 240),
                    title_zh: sanitizeText(prompt?.title_zh, 240),
                    title_en: sanitizeText(prompt?.title_en, 240),
                    image: Array.isArray(prompt?.images) ? sanitizeText(prompt.images[0], 2048) : '',
                    tags: Array.isArray(prompt?.tags) ? prompt.tags.map((item) => sanitizeText(item, 80)).filter(Boolean).slice(0, 8) : [],
                    candidate_reason: ops.note || '来自 Gallery 候选池',
                    recommended_by: ops.recommended_by || '运营',
                    current_site_fit: true,
                    featured_sites: featuredSites,
                    metrics
                };
            })
            .filter(Boolean)
            .slice(0, 24);
    } catch (_error) {
        return [];
    }
}

async function fetchHomepagePromptCatalog(supabase) {
    try {
        const { data, error } = await supabase
            .from('prompts')
            .select('id, title, title_zh, title_en, images, tags, updated_at')
            .order('updated_at', { ascending: false })
            .limit(300);

        if (error) {
            return [];
        }

        return Array.isArray(data) ? data : [];
    } catch (_error) {
        return [];
    }
}

async function fetchHomepageShopCatalog(supabase) {
    try {
        const { data, error } = await supabase
            .from('shop_products')
            .select('id, name, name_en, description, description_en, icon_url, price_points, price_points_intl, stock_count, category, is_active, display_order')
            .order('display_order', { ascending: false })
            .limit(200);

        if (error) {
            return [];
        }

        return Array.isArray(data) ? data : [];
    } catch (_error) {
        return [];
    }
}

async function fetchHomepageGuestbookCandidates(supabase, site) {
    try {
        const { data, error } = await supabase
            .from('guestbook_messages')
            .select('id, content, image_url, like_count, created_at, user_id, profiles:user_id (username, avatar_url)')
            .eq('site', normalizeHomepageSite(site))
            .order('created_at', { ascending: false })
            .limit(24);

        if (error) {
            return [];
        }

        return Array.isArray(data) ? data : [];
    } catch (_error) {
        return [];
    }
}

async function fetchHomepageShopCategories(supabase) {
    try {
        const { data, error } = await supabase
            .from('shop_categories')
            .select('*')
            .order('sort_order', { ascending: true });

        if (error) {
            return [];
        }

        return Array.isArray(data) ? data : [];
    } catch (_error) {
        return [];
    }
}

function getHomepageExperimentFieldLabel(section, field) {
    return HOMEPAGE_EXPERIMENT_FIELD_LABELS?.[section]?.[field] || `${section}.${field}`;
}

function getHomepageSectionDisplayLabel(section) {
    switch (sanitizeText(section, 40)) {
        case 'hero':
            return 'Hero';
        case 'prompts':
            return '提示词';
        case 'shop':
            return '商城';
        case 'verify':
            return '验证';
        case 'guestbook':
            return '留言板';
        case 'ticker':
            return 'Ticker';
        default:
            return section || '首页';
    }
}

function getHomepageSitePrimaryText(content = {}, field, site) {
    const primaryLang = getHomepagePrimaryLanguage(site);
    return sanitizeText(
        content?.[`${field}_${primaryLang}`]
        || content?.[field],
        600
    );
}

function buildHomepageExperimentValuePreview(section, field, value, site) {
    if (field === 'featured_items' || field === 'custom_items') {
        const items = Array.isArray(value) ? value : [];
        if (!items.length) {
            return '未配置';
        }
        return items
            .slice(0, 3)
            .map((item) => sanitizeText(
                item?.title
                || item?.title_zh
                || item?.title_en
                || item?.name
                || item?.name_en
                || item?.username
                || item?.author
                || item?.content
                || item?.id,
                60
            ))
            .filter(Boolean)
            .join(' / ');
    }

    return sanitizeText(value, 180) || '未配置';
}

function buildHomepagePromptSnapshot(prompt = {}) {
    const promptId = sanitizeText(prompt?.id, 160);
    if (!promptId) {
        return null;
    }

    return {
        id: promptId,
        title: sanitizeText(prompt?.title, 240),
        title_zh: sanitizeText(prompt?.title_zh, 240),
        title_en: sanitizeText(prompt?.title_en, 240),
        image: Array.isArray(prompt?.images) ? sanitizeText(prompt.images[0], 2048) : '',
        tags: Array.isArray(prompt?.tags)
            ? prompt.tags.map((item) => sanitizeText(item, 80)).filter(Boolean).slice(0, 8)
            : []
    };
}

function buildHomepageShopSnapshot(product = {}) {
    const productId = sanitizeText(product?.id, 160);
    if (!productId) {
        return null;
    }

    return {
        id: productId,
        name: sanitizeText(product?.name, 160),
        name_en: sanitizeText(product?.name_en, 160),
        description: sanitizeText(product?.description, 320),
        description_en: sanitizeText(product?.description_en, 320),
        icon_url: sanitizeText(product?.icon_url, 2048),
        category: sanitizeText(product?.category, 120),
        stock_count: Number(product?.stock_count || 0) || 0,
        is_active: product?.is_active !== false
    };
}

function hasHomepageShopSitePrice(product = {}, site) {
    const priceField = normalizeHomepageSite(site) === 'intl' ? 'price_points_intl' : 'price_points';
    const rawPrice = product?.[priceField];
    return rawPrice !== null && rawPrice !== undefined && rawPrice !== '' && Number.isFinite(Number(rawPrice));
}

function buildHomepageGuestbookSnapshot(message = {}) {
    const messageId = sanitizeText(message?.id, 160);
    if (!messageId) {
        return null;
    }

    return {
        id: messageId,
        content: sanitizeText(message?.content, 600),
        image_url: sanitizeText(message?.image_url, 2048),
        like_count: Number(message?.like_count || 0) || 0,
        created_at: sanitizeText(message?.created_at, 80),
        user_id: sanitizeText(message?.user_id, 160),
        username: sanitizeText(message?.profiles?.username || message?.username, 120),
        avatar_url: sanitizeText(message?.profiles?.avatar_url || message?.avatar_url, 2048)
    };
}

function collectHomepageExperiments(rows = [], site) {
    const normalizedSite = normalizeHomepageSite(site);
    return (Array.isArray(rows) ? rows : []).flatMap((row) => {
        const section = sanitizeText(row?.section, 80);
        const experiments = Array.isArray(row?.content?.experiments) ? row.content.experiments : [];
        return experiments.map((experiment) => ({
            ...experiment,
            section,
            field_label: getHomepageExperimentFieldLabel(section, experiment.field),
            control_preview: buildHomepageExperimentValuePreview(section, experiment.field, experiment.control_value, normalizedSite),
            variant_preview: buildHomepageExperimentValuePreview(section, experiment.field, experiment.variant_value, normalizedSite)
        }));
    });
}

function buildEmptyHomepageExperimentVariantMetrics() {
    return {
        impressions_7d: 0,
        clicks_7d: 0,
        conversions_7d: 0,
        interactions_7d: 0,
        impressions_30d: 0,
        clicks_30d: 0,
        conversions_30d: 0,
        interactions_30d: 0,
        ctr_7d: 0,
        ctr_30d: 0
    };
}

function finalizeHomepageExperimentVariantMetrics(metrics = {}) {
    const next = {
        ...buildEmptyHomepageExperimentVariantMetrics(),
        ...metrics
    };

    next.ctr_7d = next.impressions_7d > 0 ? Number((next.clicks_7d / next.impressions_7d).toFixed(4)) : 0;
    next.ctr_30d = next.impressions_30d > 0 ? Number((next.clicks_30d / next.impressions_30d).toFixed(4)) : 0;
    return next;
}

function incrementHomepageExperimentVariantMetric(target, variantKey, metric, windowKey) {
    if (!target || !['control', 'variant'].includes(variantKey)) {
        return;
    }
    const key = `${metric}_${windowKey}`;
    target[variantKey][key] = Number(target[variantKey][key] || 0) + 1;
}

function extractEventExperiments(record) {
    const metadata = extractEventMetadata(record);
    return (Array.isArray(metadata?.experiments) ? metadata.experiments : [])
        .map((experiment) => ({
            id: sanitizeText(experiment?.id || experiment?.experiment_id, 160),
            section: sanitizeText(experiment?.section, 80),
            field: sanitizeText(experiment?.field, 80),
            variant_key: sanitizeText(experiment?.variant_key || experiment?.variantKey, 40)
        }))
        .filter((experiment) => experiment.id && ['control', 'variant'].includes(experiment.variant_key));
}

function getHomepageExperimentEventMetric(eventName = '') {
    switch (sanitizeText(eventName, 80)) {
        case 'homepage_entry_click':
        case 'homepage_prompt_click':
        case 'homepage_shop_click':
        case 'homepage_verify_click':
        case 'homepage_guestbook_click':
        case 'homepage_ticker_click':
            return 'clicks';
        case 'verify_submit':
        case 'guestbook_post':
            return 'conversions';
        case 'unlock_success':
        case 'verify_success':
            return 'interactions';
        default:
            return '';
    }
}

function evaluateHomepageExperimentWinner(control = {}, variant = {}) {
    const controlCtr = Number(control?.ctr_7d || 0);
    const variantCtr = Number(variant?.ctr_7d || 0);
    const controlImpressions = Number(control?.impressions_7d || 0);
    const variantImpressions = Number(variant?.impressions_7d || 0);
    const controlClicks = Number(control?.clicks_7d || 0);
    const variantClicks = Number(variant?.clicks_7d || 0);

    if (Math.max(controlImpressions, variantImpressions) < 10) {
        return {
            winner: 'inconclusive',
            winner_reason: '近 7 天样本不足，建议继续观察'
        };
    }

    if (Math.abs(variantCtr - controlCtr) < 0.01 && Math.abs(variantClicks - controlClicks) < 3) {
        return {
            winner: 'inconclusive',
            winner_reason: '两组 CTR 接近，暂时没有明显胜出版本'
        };
    }

    if (variantCtr > controlCtr || (variantCtr === controlCtr && variantClicks > controlClicks)) {
        return {
            winner: 'variant',
            winner_reason: '实验版本近 7 天 CTR 更高'
        };
    }

    return {
        winner: 'control',
        winner_reason: '对照版本近 7 天 CTR 更稳'
    };
}

async function fetchHomepageExperimentResults(supabase, site, rows = []) {
    const experiments = collectHomepageExperiments(rows, site);
    if (!experiments.length) {
        return [];
    }

    const experimentMap = new Map();
    experiments.forEach((experiment) => {
        experimentMap.set(experiment.id, {
            ...experiment,
            control: buildEmptyHomepageExperimentVariantMetrics(),
            variant: buildEmptyHomepageExperimentVariantMetrics()
        });
    });

    try {
        const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
        const sevenDaysAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);

        const { data, error } = await supabase
            .from('user_events')
            .select('event_name, event_data, created_at, site')
            .eq('site', normalizeHomepageSite(site))
            .in('event_name', HOMEPAGE_ANALYTICS_EVENT_NAMES)
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false })
            .limit(4000);

        if (error) {
            return experiments.map((experiment) => ({
                ...experiment,
                control: finalizeHomepageExperimentVariantMetrics(),
                variant: finalizeHomepageExperimentVariantMetrics(),
                winner: 'inconclusive',
                winner_reason: '暂时没有实验事件数据',
                can_promote_winner: false
            }));
        }

        (Array.isArray(data) ? data : []).forEach((record) => {
            const eventName = sanitizeText(record?.event_name, 80);
            const createdAtMs = Date.parse(record?.created_at || 0);
            const windowKeys = Number.isFinite(createdAtMs) && createdAtMs >= sevenDaysAgoMs ? ['30d', '7d'] : ['30d'];

            if (eventName === 'homepage_experiment_impression') {
                const metadata = extractEventMetadata(record);
                const experimentId = sanitizeText(metadata?.experiment_id || extractEventEntityId(record), 160);
                const variantKey = sanitizeText(metadata?.variant_key || metadata?.variantKey, 40);
                const bucket = experimentMap.get(experimentId);
                if (!bucket || !['control', 'variant'].includes(variantKey)) {
                    return;
                }
                windowKeys.forEach((windowKey) => {
                    incrementHomepageExperimentVariantMetric(bucket, variantKey, 'impressions', windowKey);
                });
                return;
            }

            const metric = getHomepageExperimentEventMetric(eventName);
            if (!metric) {
                return;
            }

            extractEventExperiments(record).forEach((experimentRef) => {
                const bucket = experimentMap.get(experimentRef.id);
                if (!bucket) {
                    return;
                }
                windowKeys.forEach((windowKey) => {
                    incrementHomepageExperimentVariantMetric(bucket, experimentRef.variant_key, metric, windowKey);
                });
            });
        });
    } catch (_error) {
        // Ignore experiment analytics failure and fall back to empty metrics.
    }

    return Array.from(experimentMap.values()).map((experiment) => {
        const control = finalizeHomepageExperimentVariantMetrics(experiment.control);
        const variant = finalizeHomepageExperimentVariantMetrics(experiment.variant);
        const winnerState = evaluateHomepageExperimentWinner(control, variant);
        return {
            ...experiment,
            control,
            variant,
            ...winnerState,
            can_promote_winner: winnerState.winner !== 'inconclusive'
        };
    });
}

function buildHomepageAnalyticsItemMap(items = []) {
    return new Map(
        (Array.isArray(items) ? items : [])
            .map((item) => [sanitizeText(item?.id, 160), item])
            .filter(([id]) => Boolean(id))
    );
}

function getHomepageMetricTrendSignal(metrics = {}, section, label) {
    const impressions7d = Number(metrics?.impressions_7d || 0);
    const impressions30d = Number(metrics?.impressions_30d || 0);
    const clicks7d = Number(metrics?.clicks_7d || 0);
    const clicks30d = Number(metrics?.clicks_30d || 0);
    const previousImpressions = Math.max(0, impressions30d - impressions7d);
    const previousClicks = Math.max(0, clicks30d - clicks7d);

    if (impressions7d < 20 || previousImpressions < 20) {
        return null;
    }

    const currentCtr = impressions7d > 0 ? clicks7d / impressions7d : 0;
    const previousCtr = previousImpressions > 0 ? previousClicks / previousImpressions : 0;

    if (previousCtr > 0 && currentCtr < previousCtr * 0.65) {
        return {
            id: `signal_ctr_drop_${section}`,
            type: 'ctr_drop',
            section,
            label,
            title: `${label} CTR 下滑`,
            summary: `近 7 天 CTR 明显低于此前 30 天均值，建议检查素材疲劳和入口文案`,
            tone: 'warning'
        };
    }

    return null;
}

function buildHomepageRecommendations(rows = [], context = {}) {
    const rowMap = mapHomepageRowsBySection(rows);
    const site = normalizeHomepageSite(context.site);
    const analytics = context.analytics || buildEmptyHomepageAnalyticsPayload();
    const promptCandidates = Array.isArray(context.prompt_candidates) ? context.prompt_candidates : [];
    const shopProducts = Array.isArray(context.shop_products)
        ? context.shop_products.filter((product) => product?.is_active !== false && hasHomepageShopSitePrice(product, site))
        : [];
    const guestbookMessages = Array.isArray(context.guestbook_messages) ? context.guestbook_messages : [];

    const promptMetricMap = buildHomepageAnalyticsItemMap(analytics?.items?.prompts);
    const shopMetricMap = buildHomepageAnalyticsItemMap(analytics?.items?.shop);
    const promptFeaturedItems = Array.isArray(rowMap.prompts?.content?.featured_items) ? rowMap.prompts.content.featured_items : [];
    const shopCuratedItems = Array.isArray(rowMap.shop?.content?.custom_items) ? rowMap.shop.content.custom_items : [];
    const guestbookFeaturedItems = Array.isArray(rowMap.guestbook?.content?.featured_items) ? rowMap.guestbook.content.featured_items : [];

    const recommendations = [];
    const signals = [];

    [
        ['prompts', '提示词', analytics?.sections?.prompts],
        ['shop', '商城', analytics?.sections?.shop],
        ['verify', '验证', analytics?.sections?.verify],
        ['guestbook', '留言板', analytics?.sections?.guestbook]
    ].forEach(([section, label, metrics]) => {
        const signal = getHomepageMetricTrendSignal(metrics, section, label);
        if (signal) {
            signals.push(signal);
        }
    });

    const verifyMetrics = analytics?.sections?.verify || {};
    if (Number(verifyMetrics.clicks_7d || 0) >= 10 && Number(verifyMetrics.conversions_7d || 0) <= 1) {
        signals.push({
            id: 'signal_verify_click_no_convert',
            type: 'click_convert_gap',
            section: 'verify',
            label: '验证',
            title: 'Verify 点击高但转化低',
            summary: '首页 Verify 引导有点击但缺少后续转化，建议检查 CTA 文案和落地页一致性',
            tone: 'warning'
        });
    }

    if (promptFeaturedItems.length) {
        const featuredIds = new Set(promptFeaturedItems.map((item) => sanitizeText(item?.id, 160)).filter(Boolean));
        const currentWorst = promptFeaturedItems
            .map((item, index) => ({
                index,
                item,
                score: Number(promptMetricMap.get(sanitizeText(item?.id, 160))?.clicks_7d || 0)
            }))
            .sort((left, right) => left.score - right.score)[0];
        const bestCandidate = promptCandidates
            .filter((item) => !featuredIds.has(sanitizeText(item?.id, 160)))
            .map((item) => ({
                item,
                score: (Number(item?.metrics?.unlock_success_7d || 0) * 3)
                    + (Number(item?.metrics?.homepage_click_7d || 0) * 2)
                    + Number(item?.metrics?.prompt_view_7d || 0)
            }))
            .sort((left, right) => right.score - left.score)[0];

        if (currentWorst?.item && bestCandidate?.item && bestCandidate.score > currentWorst.score) {
            recommendations.push({
                id: `prompt_replace_${sanitizeText(currentWorst.item?.id, 160)}_${sanitizeText(bestCandidate.item?.id, 160)}`,
                section: 'prompts',
                type: 'replace_featured_prompt',
                title: '替换 Prompt 精选位',
                summary: `${sanitizeText(bestCandidate.item?.title || bestCandidate.item?.id, 80)} 最近 7 天表现更强，可替换当前弱势精选`,
                reason: `候选解锁 ${Number(bestCandidate.item?.metrics?.unlock_success_7d || 0)}，当前位点击 ${currentWorst.score}`,
                target_id: sanitizeText(currentWorst.item?.id, 160),
                suggested_item: cloneHomepageJson(bestCandidate.item),
                target_index: currentWorst.index
            });
        }
    }

    const currentShopIds = new Set(shopCuratedItems.map((item) => sanitizeText(item?.id, 160)).filter(Boolean));
    const shopFallbackTarget = shopCuratedItems
        .map((item, index) => ({
            index,
            item,
            score: Number(shopMetricMap.get(sanitizeText(item?.id, 160))?.clicks_7d || 0),
            inactive: item?.is_active === false || Number(item?.stock_count || 0) <= 0
        }))
        .sort((left, right) => {
            if (left.inactive !== right.inactive) {
                return left.inactive ? -1 : 1;
            }
            return left.score - right.score;
        })[0];
    const bestShopCandidate = shopProducts
        .filter((item) => item?.is_active !== false && !currentShopIds.has(sanitizeText(item?.id, 160)))
        .map((item) => ({
            item,
            score: (Number(shopMetricMap.get(sanitizeText(item?.id, 160))?.clicks_7d || 0) * 3)
                + Math.min(20, Number(item?.stock_count || 0))
        }))
        .sort((left, right) => right.score - left.score)[0];

    if (bestShopCandidate?.item && (shopFallbackTarget?.inactive || bestShopCandidate.score > Number(shopFallbackTarget?.score || 0))) {
        recommendations.push({
            id: `shop_replace_${sanitizeText(shopFallbackTarget?.item?.id, 160) || 'empty'}_${sanitizeText(bestShopCandidate.item?.id, 160)}`,
            section: 'shop',
            type: 'replace_curated_shop_item',
            title: '补强商城精选位',
            summary: `${sanitizeText(bestShopCandidate.item?.name || bestShopCandidate.item?.id, 80)} 更适合放入首页精选`,
            reason: shopFallbackTarget?.inactive
                ? '当前精选中存在下架或库存不足商品'
                : '候选商品兼具库存和近期点击潜力',
            target_id: sanitizeText(shopFallbackTarget?.item?.id, 160),
            suggested_item: cloneHomepageJson(bestShopCandidate.item),
            target_index: Number.isFinite(shopFallbackTarget?.index) ? shopFallbackTarget.index : 0
        });
    }

    const currentGuestbookIds = new Set(guestbookFeaturedItems.map((item) => sanitizeText(item?.id, 160)).filter(Boolean));
    const weakestGuestbook = guestbookFeaturedItems
        .map((item, index) => ({
            index,
            item,
            score: Number(item?.like_count || 0)
        }))
        .sort((left, right) => left.score - right.score)[0];
    const bestGuestbookCandidate = guestbookMessages
        .filter((item) => !currentGuestbookIds.has(sanitizeText(item?.id, 160)))
        .map((item) => ({
            item,
            score: (Number(item?.like_count || 0) * 3) + (Date.parse(item?.created_at || 0) || 0) / 1e11
        }))
        .sort((left, right) => right.score - left.score)[0];

    if (bestGuestbookCandidate?.item && (!weakestGuestbook || bestGuestbookCandidate.score > weakestGuestbook.score)) {
        recommendations.push({
            id: `guestbook_replace_${sanitizeText(weakestGuestbook?.item?.id, 160) || 'empty'}_${sanitizeText(bestGuestbookCandidate.item?.id, 160)}`,
            section: 'guestbook',
            type: 'replace_featured_guestbook_item',
            title: '替换留言精选位',
            summary: '最近互动更高的留言适合进入首页精选',
            reason: `候选点赞 ${Number(bestGuestbookCandidate.item?.like_count || 0)}，更适合作为社区氛围展示`,
            target_id: sanitizeText(weakestGuestbook?.item?.id, 160),
            suggested_item: cloneHomepageJson(bestGuestbookCandidate.item),
            target_index: Number.isFinite(weakestGuestbook?.index) ? weakestGuestbook.index : 0
        });
    }

    return {
        signals,
        items: recommendations
    };
}

function buildHomepageAlerts(site, rows = [], health = null, recommendations = null, experiments = []) {
    const alerts = [];
    const rowMap = mapHomepageRowsBySection(rows);

    ['hero', 'prompts', 'shop', 'verify'].forEach((section) => {
        if (rowMap[section]?.is_visible === false) {
            alerts.push({
                id: `hidden_${section}`,
                level: section === 'hero' ? 'error' : 'warning',
                section,
                title: `${getHomepageSectionDisplayLabel(section)} 模块被隐藏`,
                summary: '这是首页核心模块，建议确认是否为预期操作'
            });
        }
    });

    if (!Array.isArray(rows) || rows.length < 6) {
        alerts.push({
            id: 'missing_sections',
            level: 'error',
            section: 'homepage',
            title: '发布版本不完整',
            summary: '当前首页缺少部分核心模块配置，建议检查发布数据'
        });
    }

    (health?.errors || []).forEach((item, index) => {
        alerts.push({
            id: `health_error_${index}`,
            level: 'error',
            section: item.section,
            title: '首页健康检查失败',
            summary: item.message
        });
    });

    (health?.warnings || []).forEach((item, index) => {
        alerts.push({
            id: `health_warning_${index}`,
            level: 'warning',
            section: item.section,
            title: '首页存在风险提醒',
            summary: item.message
        });
    });

    (recommendations?.signals || []).forEach((signal) => {
        alerts.push({
            id: `signal_${signal.id}`,
            level: signal.tone === 'warning' ? 'warning' : 'info',
            section: signal.section,
            title: signal.title,
            summary: signal.summary
        });
    });

    (Array.isArray(experiments) ? experiments : [])
        .filter((experiment) => experiment.status === 'active' && experiment.winner === 'variant')
        .slice(0, 3)
        .forEach((experiment) => {
            alerts.push({
                id: `experiment_winner_${experiment.id}`,
                level: 'info',
                section: experiment.section,
                title: '实验版本已出现优势',
                summary: `${experiment.field_label} 可考虑将实验胜出版本转正`
            });
        });

    return {
        generated_at: new Date().toISOString(),
        items: alerts.slice(0, 12)
    };
}

function buildHomepageReports(site, analytics = {}, alerts = {}, recommendations = {}, experiments = []) {
    const siteLabel = normalizeHomepageSite(site) === 'intl' ? 'INTL 站' : 'CN 站';
    const promptsMetrics = analytics?.sections?.prompts || {};
    const shopMetrics = analytics?.sections?.shop || {};
    const verifyMetrics = analytics?.sections?.verify || {};
    const guestbookMetrics = analytics?.sections?.guestbook || {};
    const alertCount = Array.isArray(alerts?.items) ? alerts.items.length : 0;
    const recommendationCount = Array.isArray(recommendations?.items) ? recommendations.items.length : 0;
    const activeExperiments = (Array.isArray(experiments) ? experiments : []).filter((item) => item.status === 'active');

    return {
        daily: {
            title: `${siteLabel} 首页运营日报`,
            generated_at: new Date().toISOString(),
            lines: [
                `Prompt 7d 点击 ${Number(promptsMetrics.clicks_7d || 0)}，Shop 7d 点击 ${Number(shopMetrics.clicks_7d || 0)}`,
                `Verify 7d 转化 ${Number(verifyMetrics.conversions_7d || 0)}，Guestbook 7d 互动 ${Number(guestbookMetrics.conversions_7d || 0)}`,
                `当前巡检告警 ${alertCount} 条，待确认推荐 ${recommendationCount} 条`,
                activeExperiments.length
                    ? `运行中实验 ${activeExperiments.length} 个，优先关注 ${activeExperiments[0].field_label}`
                    : '当前没有运行中的首页实验'
            ]
        },
        weekly: {
            title: `${siteLabel} 首页运营周报`,
            generated_at: new Date().toISOString(),
            lines: [
                `Prompt 30d 点击 ${Number(promptsMetrics.clicks_30d || 0)}，Shop 30d 点击 ${Number(shopMetrics.clicks_30d || 0)}`,
                `Verify 30d 转化 ${Number(verifyMetrics.conversions_30d || 0)}，Guestbook 30d 互动 ${Number(guestbookMetrics.conversions_30d || 0)}`,
                alertCount
                    ? `本周仍有 ${alertCount} 条首页告警需要收口`
                    : '本周首页未发现阻塞级问题',
                recommendationCount
                    ? `建议优先执行 ${recommendationCount} 条推荐动作，缩短人工判断链路`
                    : '当前无需额外推荐动作'
            ]
        }
    };
}

function buildBuiltinHomepageThemePacks(site) {
    const normalizedSite = normalizeHomepageSite(site);
    const primaryLang = getHomepagePrimaryLanguage(normalizedSite);
    const copy = (zh, en) => primaryLang === 'en' ? en : zh;

    return [
        {
            id: 'builtin_festival_campaign',
            source: 'builtin',
            name: copy('节日活动主题包', 'Festival Campaign Pack'),
            description: copy('统一 Hero、精选文案和跑马灯，适合节日活动或平台节点运营。', 'Unify hero copy, featured modules, and ticker for seasonal campaigns.'),
            section_keys: HOMEPAGE_THEME_PACK_SECTION_KEYS,
            sections: {
                hero: {
                    title: copy('节日创作季', 'Seasonal Creative Sprint'),
                    subtitle: copy('专题活动、资源补给与社区互动同步升温', 'Launch a focused campaign across content, commerce, and community')
                },
                prompts: {
                    section_title: copy('节日灵感 Prompt', 'Seasonal Prompt Picks'),
                    section_subtitle: copy('快速切入节日海报、活动 KV 和社媒内容', 'Go from idea to campaign visuals in one pass')
                },
                shop: {
                    section_title: copy('活动资源补给站', 'Campaign Resource Shelf'),
                    section_subtitle: copy('把当前活动期最需要的资源排到前面', 'Bring event-ready assets to the front of the homepage')
                },
                verify: {
                    section_title: copy('活动验证准备', 'Campaign Verification Readiness'),
                    section_subtitle: copy('上线前快速确认当前账号与接口可用', 'Validate keys and limits before campaign traffic starts'),
                    cta_text: copy('开始验证', 'Start Validation'),
                    risk_notice: copy('活动上线前建议先完成测试密钥验证，再切换正式环境。', 'Validate test credentials first, then switch to production before launch.')
                },
                guestbook: {
                    section_title: copy('活动社区反馈', 'Campaign Community Pulse'),
                    section_subtitle: copy('优先展示活动期的用户反馈和互动氛围', 'Surface community energy around the live campaign')
                },
                ticker: {
                    activity_keywords: primaryLang === 'en'
                        ? ['Campaign launch', 'Holiday poster', 'Limited-time event', 'Community challenge']
                        : ['活动发布', '节日海报', '限时专题', '社区挑战'],
                    custom_items_top: primaryLang === 'en'
                        ? ['Holiday visuals', 'Event banner', 'Promo card']
                        : ['节日视觉', '活动横幅', '促销卡片'],
                    custom_items_bottom: primaryLang === 'en'
                        ? ['Starter kit', 'Campaign bundle', 'Creator tools']
                        : ['活动套餐', '上新工具', '创作补给']
                }
            }
        },
        {
            id: 'builtin_new_release_launch',
            source: 'builtin',
            name: copy('新品发布主题包', 'New Release Launch Pack'),
            description: copy('强化新品上新节奏，适合新资源、新能力发布。', 'Focus the homepage on new launches and newly shipped capabilities.'),
            section_keys: HOMEPAGE_THEME_PACK_SECTION_KEYS,
            sections: {
                hero: {
                    title: copy('本周上新', 'New This Week'),
                    subtitle: copy('把新资源、新能力和上线反馈集中排到首页首屏', 'Turn the homepage into a clean launch surface for what just shipped')
                },
                prompts: {
                    section_title: copy('最新 Prompt 上新', 'Fresh Prompt Releases'),
                    section_subtitle: copy('优先展示最近上新的提示词和视觉主题', 'Spotlight newly published prompt ideas first')
                },
                shop: {
                    section_title: copy('新品资源首发', 'New Resource Launch'),
                    section_subtitle: copy('把当前最值得推的新资源排到首页精选', 'Feature launch-ready products and bundles')
                },
                verify: {
                    section_title: copy('发布前验证', 'Launch Checklist Validation'),
                    section_subtitle: copy('新品上线前先确认密钥、额度和接口状态', 'Check keys, quota, and endpoints before launch'),
                    cta_text: copy('验证发布环境', 'Validate Launch Env')
                },
                guestbook: {
                    section_title: copy('新品反馈', 'Launch Feedback'),
                    section_subtitle: copy('收集用户对上新资源的第一波反馈', 'Capture the first wave of reactions to new launches')
                },
                ticker: {
                    activity_keywords: primaryLang === 'en'
                        ? ['New release', 'Fresh drop', 'Launch week', 'Creator update']
                        : ['新品发布', '本周上新', '发售周', '创作者更新']
                }
            }
        },
        {
            id: 'builtin_intl_focus',
            source: 'builtin',
            name: copy('国际站专题包', 'International Spotlight Pack'),
            description: copy('适合国际站专题页、英文投放或海外用户导流。', 'Optimize the homepage for international traffic and English-first positioning.'),
            section_keys: HOMEPAGE_THEME_PACK_SECTION_KEYS,
            sections: {
                hero: {
                    title: copy('国际站专题', 'Global Spotlight'),
                    subtitle: copy('围绕海外用户习惯重排首屏入口与增长模块', 'Re-sequence homepage entry points for international traffic')
                },
                prompts: {
                    section_title: copy('国际站精选 Prompt', 'International Prompt Picks'),
                    section_subtitle: copy('优先展示适合海外投放和英文创作的内容', 'Prioritize prompts fit for English-first creative work')
                },
                shop: {
                    section_title: copy('国际站资源推荐', 'Global Store Highlights'),
                    section_subtitle: copy('把适合国际用户购买的资源前置到首页', 'Bring globally relevant offers to the front')
                },
                verify: {
                    section_title: copy('国际接口验证', 'International API Validation'),
                    section_subtitle: copy('为跨区账号和外部调用场景保留明确验证入口', 'Keep a visible validation path for cross-region usage'),
                    cta_text: copy('验证国际接口', 'Validate Global API')
                },
                guestbook: {
                    section_title: copy('国际用户反馈', 'International Community Notes'),
                    section_subtitle: copy('展示不同地区用户的真实反馈与案例', 'Feature notes and reactions from international users')
                },
                ticker: {
                    custom_items_top: primaryLang === 'en'
                        ? ['Global creators', 'English prompts', 'International tools']
                        : ['海外创作者', '英文提示词', '国际工具'],
                    custom_items_bottom: primaryLang === 'en'
                        ? ['Cross-region access', 'Intl bundles', 'Global launch']
                        : ['跨区访问', '国际套餐', '海外发布']
                }
            }
        },
        {
            id: 'builtin_community_event',
            source: 'builtin',
            name: copy('社区活动主题包', 'Community Event Pack'),
            description: copy('强化留言板、精选案例和社区感，适合互动活动或用户征集。', 'Lean into community momentum, submissions, and user interaction.'),
            section_keys: HOMEPAGE_THEME_PACK_SECTION_KEYS,
            sections: {
                hero: {
                    title: copy('社区共创进行中', 'Community Build-in-Public'),
                    subtitle: copy('用首页串起精选内容、互动留言和活动参与入口', 'Tie featured content, comments, and event entry points together')
                },
                prompts: {
                    section_title: copy('社区共创 Prompt', 'Community Prompt Picks'),
                    section_subtitle: copy('优先展示社区热度高、适合二次创作的内容', 'Feature prompts with strong remix potential')
                },
                shop: {
                    section_title: copy('社区实用资源', 'Community Resource Picks'),
                    section_subtitle: copy('为活动参与者准备更直接的资源入口', 'Offer a faster path to the right resources')
                },
                verify: {
                    section_title: copy('活动验证通道', 'Event Verification Path'),
                    section_subtitle: copy('引导活动参与者先完成接口可用性确认', 'Make API readiness visible before participants dive in'),
                    cta_text: copy('先做验证', 'Validate First')
                },
                guestbook: {
                    section_title: copy('社区精选留言', 'Community Featured Notes'),
                    section_subtitle: copy('把高互动留言和活动感受放在首页中部', 'Bring the strongest community reactions into view')
                },
                ticker: {
                    activity_keywords: primaryLang === 'en'
                        ? ['Community event', 'Creator challenge', 'Guestbook highlights']
                        : ['社区活动', '创作者挑战', '留言精选']
                }
            }
        }
    ];
}

function buildHomepageThemePackList(site, templates = []) {
    const builtins = buildBuiltinHomepageThemePacks(site);
    const templatePacks = (Array.isArray(templates) ? templates : [])
        .filter((template) => HOMEPAGE_THEME_TEMPLATE_TYPES.has(sanitizeText(template?.template_type, 80)))
        .map((template) => ({
            id: `template_${template.id}`,
            source: 'template',
            template_id: template.id,
            name: sanitizeText(template?.name, 120) || `主题包 #${template.id}`,
            description: sanitizeText(template?.description, 240),
            template_type: sanitizeText(template?.template_type, 80) || 'theme_pack',
            section_keys: Object.keys(parseJsonObject(template?.payload?.sections || {})),
            sections: Object.entries(parseJsonObject(template?.payload?.sections || {})).reduce((accumulator, [section, sectionValue]) => {
                accumulator[section] = parseJsonObject(sectionValue?.content || sectionValue);
                return accumulator;
            }, {})
        }));

    return [...builtins, ...templatePacks];
}

function getHomepageExperimentControlValue(section, field, content = {}, site) {
    if (field === 'title' || field === 'subtitle') {
        return getHomepageSitePrimaryText(content, field, site);
    }

    if (field === 'cta_text') {
        return sanitizeText(content?.cta_text, 600);
    }

    if (field === 'featured_items' || field === 'custom_items') {
        return cloneHomepageJson(Array.isArray(content?.[field]) ? content[field] : []);
    }

    return null;
}

async function resolveHomepageExperimentVariantValue(supabase, site, section, field, variantInput) {
    if (field === 'title' || field === 'subtitle' || field === 'cta_text') {
        return sanitizeText(variantInput, 600);
    }

    const ids = parseDelimitedExperimentIds(variantInput);
    if (!ids.length) {
        return [];
    }

    if (section === 'prompts' && field === 'featured_items') {
        const promptCatalog = await fetchHomepagePromptCatalog(supabase);
        const promptMap = new Map(
            promptCatalog
                .map((item) => [sanitizeText(item?.id, 160), item])
                .filter(([id]) => Boolean(id))
        );

        return ids
            .map((id) => buildHomepagePromptSnapshot(promptMap.get(id)))
            .filter(Boolean)
            .slice(0, 12);
    }

    if (section === 'shop' && field === 'custom_items') {
        const shopCatalog = await fetchHomepageShopCatalog(supabase);
        const shopMap = new Map(
            shopCatalog
                .map((item) => [sanitizeText(item?.id, 160), item])
                .filter(([id]) => Boolean(id))
        );

        return ids
            .map((id) => buildHomepageShopSnapshot(shopMap.get(id)))
            .filter(Boolean)
            .slice(0, 12);
    }

    if (section === 'guestbook' && field === 'featured_items') {
        const guestbookMessages = await fetchHomepageGuestbookCandidates(supabase, site);
        const guestbookMap = new Map(
            guestbookMessages
                .map((item) => [sanitizeText(item?.id, 160), item])
                .filter(([id]) => Boolean(id))
        );

        return ids
            .map((id) => buildHomepageGuestbookSnapshot(guestbookMap.get(id)))
            .filter(Boolean)
            .slice(0, 12);
    }

    return [];
}

function resolveHomepageExperimentRows(rows = [], experimentId = '') {
    const normalizedId = sanitizeText(experimentId, 160);
    if (!normalizedId) {
        return null;
    }

    for (const row of Array.isArray(rows) ? rows : []) {
        const experiments = Array.isArray(row?.content?.experiments) ? row.content.experiments : [];
        const experiment = experiments.find((item) => sanitizeText(item?.id, 160) === normalizedId);
        if (experiment) {
            return { row, experiment };
        }
    }

    return null;
}

function normalizeHomepageSelectedSections(value, fallback = []) {
    const input = Array.isArray(value) ? value : parseDelimitedExperimentIds(value);
    const sections = input
        .map((item) => sanitizeText(item, 80))
        .filter((item) => HOMEPAGE_SECTION_KEYS.includes(item));
    return sections.length ? sections : fallback;
}

async function saveHomepageExperimentMutation(supabase, site, body = {}, userId) {
    const section = sanitizeText(body.section, 80);
    const field = sanitizeText(body.field, 80);
    const name = sanitizeText(body.name, 120) || `${section}.${field}`;
    const experimentId = sanitizeText(body.experiment_id || body.experimentId, 160);
    const trafficPercent = Number.parseInt(body.traffic_percent || body.trafficPercent, 10);
    const variantInput = body.variant_input ?? body.variantInput ?? '';
    const workingState = await loadHomepageWorkingState(supabase, site);
    const targetRow = workingState.rowMap[section];

    if (!targetRow?.section) {
        const error = new Error('未找到可配置实验的首页模块');
        error.statusCode = 400;
        throw error;
    }

    const controlValue = getHomepageExperimentControlValue(section, field, targetRow.content, site);
    const variantValue = await resolveHomepageExperimentVariantValue(supabase, site, section, field, variantInput);
    const hasControl = typeof controlValue === 'string'
        ? Boolean(controlValue)
        : Array.isArray(controlValue) && controlValue.length > 0;
    const hasVariant = typeof variantValue === 'string'
        ? Boolean(variantValue)
        : Array.isArray(variantValue) && variantValue.length > 0;

    if (!hasControl) {
        const error = new Error('当前槽位缺少可用对照组内容，请先补齐当前首页配置');
        error.statusCode = 400;
        throw error;
    }

    if (!hasVariant) {
        const error = new Error('请填写实验版本内容');
        error.statusCode = 400;
        throw error;
    }

    const now = new Date().toISOString();
    const nextRows = workingState.currentRows.map((row) => {
        if (row.section !== section) {
            return row;
        }

        const existingExperiments = Array.isArray(row?.content?.experiments) ? row.content.experiments : [];
        const sameSlotExperiment = existingExperiments.find((item) => item.field === field);
        const nextExperiment = {
            id: experimentId || sameSlotExperiment?.id || `exp_${section}_${field}_${Date.now()}`,
            name,
            field,
            status: 'active',
            traffic_percent: Number.isFinite(trafficPercent) ? Math.min(95, Math.max(5, trafficPercent)) : 50,
            control_value: cloneHomepageJson(controlValue),
            variant_value: cloneHomepageJson(variantValue),
            created_at: sameSlotExperiment?.created_at || now,
            updated_at: now
        };

        const nextContent = {
            ...(row.content || {}),
            experiments: [
                ...existingExperiments.filter((item) => {
                    const currentId = sanitizeText(item?.id, 160);
                    return currentId !== experimentId && item.field !== field;
                }),
                nextExperiment
            ]
        };

        return buildHomepageRowRecord({
            ...row,
            content: nextContent
        });
    });

    await upsertHomepageDraft(supabase, site, buildDraftSectionsFromHomepageRows(nextRows), userId);

    await writeAdminAuditLog({
        supabase,
        adminId: userId,
        module: 'homepage',
        site,
        actionType: 'homepage.experiment.save',
        details: {
            section,
            field,
            experiment_id: experimentId || null
        }
    });

    return buildHomepageContextPayload(supabase, site);
}

async function deleteHomepageExperimentMutation(supabase, site, body = {}, userId) {
    const experimentId = sanitizeText(body.experiment_id || body.experimentId, 160);
    if (!experimentId) {
        const error = new Error('experiment_id is required');
        error.statusCode = 400;
        throw error;
    }

    const workingState = await loadHomepageWorkingState(supabase, site);
    const target = resolveHomepageExperimentRows(workingState.currentRows, experimentId);
    if (!target?.row?.section) {
        const error = new Error('未找到对应首页实验');
        error.statusCode = 404;
        throw error;
    }

    const nextRows = workingState.currentRows.map((row) => {
        if (row.section !== target.row.section) {
            return row;
        }

        const nextExperiments = (Array.isArray(row?.content?.experiments) ? row.content.experiments : [])
            .filter((item) => sanitizeText(item?.id, 160) !== experimentId);
        const nextContent = { ...(row.content || {}) };
        if (nextExperiments.length) {
            nextContent.experiments = nextExperiments;
        } else {
            delete nextContent.experiments;
        }

        return buildHomepageRowRecord({
            ...row,
            content: nextContent
        });
    });

    await upsertHomepageDraft(supabase, site, buildDraftSectionsFromHomepageRows(nextRows), userId);

    await writeAdminAuditLog({
        supabase,
        adminId: userId,
        module: 'homepage',
        site,
        actionType: 'homepage.experiment.delete',
        details: {
            experiment_id: experimentId
        }
    });

    return buildHomepageContextPayload(supabase, site);
}

async function applyHomepageExperimentWinnerMutation(supabase, site, body = {}, userId) {
    const experimentId = sanitizeText(body.experiment_id || body.experimentId, 160);
    if (!experimentId) {
        const error = new Error('experiment_id is required');
        error.statusCode = 400;
        throw error;
    }

    const workingState = await loadHomepageWorkingState(supabase, site);
    const experimentResults = await fetchHomepageExperimentResults(supabase, site, workingState.currentRows);
    const result = experimentResults.find((item) => sanitizeText(item?.id, 160) === experimentId);
    if (!result) {
        const error = new Error('未找到对应首页实验');
        error.statusCode = 404;
        throw error;
    }

    if (result.winner === 'inconclusive') {
        const error = new Error('当前实验还没有明确胜出版本');
        error.statusCode = 400;
        throw error;
    }

    const winnerValue = result.winner === 'variant' ? result.variant_value : result.control_value;
    const nextRows = workingState.currentRows.map((row) => {
        if (row.section !== result.section) {
            return row;
        }

        const nextContent = {
            ...(row.content || {})
        };
        const remainingExperiments = (Array.isArray(nextContent.experiments) ? nextContent.experiments : [])
            .filter((item) => sanitizeText(item?.id, 160) !== experimentId);

        if (result.field === 'title' || result.field === 'subtitle') {
            nextContent[result.field] = sanitizeText(winnerValue, 600);
            nextContent[`${result.field}_${getHomepagePrimaryLanguage(site)}`] = sanitizeText(winnerValue, 600);
        } else if (result.field === 'cta_text') {
            nextContent.cta_text = sanitizeText(winnerValue, 600);
        } else {
            nextContent[result.field] = cloneHomepageJson(winnerValue);
        }

        if (remainingExperiments.length) {
            nextContent.experiments = remainingExperiments;
        } else {
            delete nextContent.experiments;
        }

        return buildHomepageRowRecord({
            ...row,
            content: nextContent
        });
    });

    await upsertHomepageDraft(supabase, site, buildDraftSectionsFromHomepageRows(nextRows), userId);

    await writeAdminAuditLog({
        supabase,
        adminId: userId,
        module: 'homepage',
        site,
        actionType: 'homepage.experiment.promote_winner',
        details: {
            experiment_id: experimentId,
            winner: result.winner
        }
    });

    return buildHomepageContextPayload(supabase, site);
}

async function applyHomepageRecommendationMutation(supabase, site, body = {}, userId) {
    const recommendationId = sanitizeText(body.recommendation_id || body.recommendationId, 160);
    if (!recommendationId) {
        const error = new Error('recommendation_id is required');
        error.statusCode = 400;
        throw error;
    }

    const workingState = await loadHomepageWorkingState(supabase, site);
    const [shopProducts, guestbookMessages, promptCandidates, analytics] = await Promise.all([
        fetchHomepageShopCatalog(supabase),
        fetchHomepageGuestbookCandidates(supabase, site),
        fetchHomepagePromptCandidates(supabase, site),
        fetchHomepageAnalytics(supabase, site)
    ]);
    const recommendations = buildHomepageRecommendations(workingState.currentRows, {
        site: normalizedSite,
        analytics,
        prompt_candidates: promptCandidates,
        shop_products: shopProducts,
        guestbook_messages: guestbookMessages
    });
    const recommendation = (recommendations.items || []).find((item) => item.id === recommendationId);
    if (!recommendation) {
        const error = new Error('未找到对应运营建议');
        error.statusCode = 404;
        throw error;
    }

    const nextRows = workingState.currentRows.map((row) => {
        if (row.section !== recommendation.section) {
            return row;
        }

        const nextContent = {
            ...(row.content || {})
        };

        if (recommendation.type === 'replace_featured_prompt') {
            const items = Array.isArray(nextContent.featured_items) ? [...nextContent.featured_items] : [];
            const replacement = buildHomepagePromptSnapshot(recommendation.suggested_item);
            if (replacement) {
                items.splice(Math.max(0, recommendation.target_index || 0), items.length ? 1 : 0, replacement);
                nextContent.featured_items = Array.from(
                    new Map(items.map((item) => [sanitizeText(item?.id, 160), item])).values()
                );
            }
        } else if (recommendation.type === 'replace_curated_shop_item') {
            const items = Array.isArray(nextContent.custom_items) ? [...nextContent.custom_items] : [];
            const replacement = buildHomepageShopSnapshot(recommendation.suggested_item);
            if (replacement) {
                items.splice(Math.max(0, recommendation.target_index || 0), items.length ? 1 : 0, replacement);
                nextContent.custom_items = Array.from(
                    new Map(items.map((item) => [sanitizeText(item?.id, 160), item])).values()
                );
            }
        } else if (recommendation.type === 'replace_featured_guestbook_item') {
            const items = Array.isArray(nextContent.featured_items) ? [...nextContent.featured_items] : [];
            const replacement = buildHomepageGuestbookSnapshot(recommendation.suggested_item);
            if (replacement) {
                replacement.reason = 'P2 推荐替换';
                items.splice(Math.max(0, recommendation.target_index || 0), items.length ? 1 : 0, replacement);
                nextContent.featured_items = Array.from(
                    new Map(items.map((item) => [sanitizeText(item?.id, 160), item])).values()
                );
            }
        }

        return buildHomepageRowRecord({
            ...row,
            content: nextContent
        });
    });

    await upsertHomepageDraft(supabase, site, buildDraftSectionsFromHomepageRows(nextRows), userId);

    await writeAdminAuditLog({
        supabase,
        adminId: userId,
        module: 'homepage',
        site,
        actionType: 'homepage.recommendation.apply',
        details: {
            recommendation_id: recommendationId,
            section: recommendation.section
        }
    });

    return buildHomepageContextPayload(supabase, site);
}

async function applyHomepageThemePackMutation(supabase, site, body = {}, userId) {
    const packId = sanitizeText(body.pack_id || body.packId, 160);
    if (!packId) {
        const error = new Error('pack_id is required');
        error.statusCode = 400;
        throw error;
    }

    const templatesResult = await loadHomepageTemplates(supabase, site);
    const themePacks = buildHomepageThemePackList(site, templatesResult.rows);
    const selectedPack = themePacks.find((item) => item.id === packId);
    if (!selectedPack) {
        const error = new Error('未找到对应主题包');
        error.statusCode = 404;
        throw error;
    }

    const sectionKeys = normalizeHomepageSelectedSections(
        body.section_keys || body.sectionKeys || body.selected_sections || body.selectedSections,
        selectedPack.section_keys
    );
    const workingState = await loadHomepageWorkingState(supabase, site);

    const nextRows = workingState.currentRows.map((row) => {
        if (!sectionKeys.includes(row.section) || !selectedPack.sections?.[row.section]) {
            return row;
        }

        return buildHomepageRowRecord({
            ...row,
            content: {
                ...(row.content || {}),
                ...cloneHomepageJson(selectedPack.sections[row.section])
            }
        });
    });

    await upsertHomepageDraft(supabase, site, buildDraftSectionsFromHomepageRows(nextRows), userId);

    await writeAdminAuditLog({
        supabase,
        adminId: userId,
        module: 'homepage',
        site,
        actionType: 'homepage.theme_pack.apply',
        details: {
            pack_id: packId,
            sections: sectionKeys
        }
    });

    return buildHomepageContextPayload(supabase, site);
}

async function buildHomepageContextPayload(supabase, site) {
    const normalizedSite = normalizeHomepageSite(site);
    const workingState = await loadHomepageWorkingState(supabase, normalizedSite);
    const [
        shopCategories,
        shopProducts,
        guestbookMessages,
        promptCandidates,
        analytics,
        templatesResult,
        schedulesResult,
        experiments
    ] = await Promise.all([
        fetchHomepageShopCategories(supabase),
        fetchHomepageShopCatalog(supabase),
        fetchHomepageGuestbookCandidates(supabase, normalizedSite),
        fetchHomepagePromptCandidates(supabase, normalizedSite),
        fetchHomepageAnalytics(supabase, normalizedSite),
        loadHomepageTemplates(supabase, normalizedSite),
        loadHomepageSchedules(supabase, normalizedSite),
        fetchHomepageExperimentResults(supabase, normalizedSite, workingState.currentRows)
    ]);

    const health = await buildHomepageHealth(supabase, normalizedSite, workingState.currentRows);
    const recommendations = buildHomepageRecommendations(workingState.currentRows, {
        site,
        analytics,
        prompt_candidates: promptCandidates,
        shop_products: shopProducts,
        guestbook_messages: guestbookMessages
    });
    const alerts = buildHomepageAlerts(normalizedSite, workingState.currentRows, health, recommendations, experiments);
    const reports = buildHomepageReports(normalizedSite, analytics, alerts, recommendations, experiments);
    const themePacks = buildHomepageThemePackList(normalizedSite, templatesResult.rows);

    return {
        success: true,
        site: normalizedSite,
        shop_categories: shopCategories,
        shop_products: shopProducts,
        guestbook_messages: guestbookMessages,
        prompt_candidates: promptCandidates,
        analytics,
        templates: templatesResult.rows,
        schedules: schedulesResult.rows,
        experiments,
        recommendations,
        alerts,
        reports,
        theme_packs: themePacks,
        orchestration_support: {
            templates_available: templatesResult.available,
            schedules_available: schedulesResult.available,
            message: templatesResult.message || schedulesResult.message || ''
        }
    };
}

function buildTemplateUpsertPayload(site, body = {}, payload, userId) {
    return {
        site: normalizeHomepageSite(site),
        name: sanitizeText(body.name, 120) || '未命名模板',
        description: sanitizeText(body.description, 240),
        template_type: sanitizeText(body.template_type || body.templateType || 'custom', 80) || 'custom',
        payload,
        source_release_id: body.source_release_id || null,
        created_by: userId || null,
        updated_at: new Date().toISOString()
    };
}

async function insertHomepageTemplate(supabase, site, body, payload, userId) {
    const upsertPayload = buildTemplateUpsertPayload(site, body, payload, userId);
    const { data, error } = await supabase
        .from('homepage_site_templates')
        .insert(upsertPayload)
        .select('id, site, name, description, template_type, payload, created_at, updated_at, created_by, source_release_id')
        .single();

    if (error) {
        if (isMissingHomepageP1Table(error)) {
            const migrationError = new Error(HOMEPAGE_P1_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return data || upsertPayload;
}

async function loadHomepageTemplateById(supabase, site, templateId) {
    const { data, error } = await supabase
        .from('homepage_site_templates')
        .select('id, site, name, description, template_type, payload, created_at, updated_at, created_by, source_release_id')
        .eq('site', normalizeHomepageSite(site))
        .eq('id', templateId)
        .single();

    if (error) {
        if (isMissingHomepageP1Table(error)) {
            const migrationError = new Error(HOMEPAGE_P1_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return data || null;
}

async function insertHomepageSchedule(supabase, site, body, payload, userId) {
    const insertPayload = {
        site: normalizeHomepageSite(site),
        template_id: body.template_id || null,
        name: sanitizeText(body.name, 120) || '首页定时发布',
        note: sanitizeText(body.note, 240),
        payload,
        starts_at: body.starts_at,
        ends_at: body.ends_at || null,
        status: 'scheduled',
        created_by: userId || null,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('homepage_site_schedules')
        .insert(insertPayload)
        .select('id, site, name, note, payload, starts_at, ends_at, status, template_id, created_at, updated_at, created_by')
        .single();

    if (error) {
        if (isMissingHomepageP1Table(error)) {
            const migrationError = new Error(HOMEPAGE_P1_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return data || insertPayload;
}

async function cancelHomepageSchedule(supabase, site, scheduleId) {
    const { data, error } = await supabase
        .from('homepage_site_schedules')
        .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
        })
        .eq('site', normalizeHomepageSite(site))
        .eq('id', scheduleId)
        .select('id, site, name, note, payload, starts_at, ends_at, status, template_id, created_at, updated_at, created_by')
        .single();

    if (error) {
        if (isMissingHomepageP1Table(error)) {
            const migrationError = new Error(HOMEPAGE_P1_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return data || null;
}

function validateScheduleWindow(body = {}) {
    const startsAt = sanitizeText(body.starts_at || body.startsAt, 80);
    const endsAt = sanitizeText(body.ends_at || body.endsAt, 80);

    if (!startsAt) {
        const error = new Error('starts_at is required');
        error.statusCode = 400;
        throw error;
    }

    const startsAtMs = Date.parse(startsAt);
    if (!Number.isFinite(startsAtMs)) {
        const error = new Error('starts_at must be a valid ISO timestamp');
        error.statusCode = 400;
        throw error;
    }

    if (endsAt) {
        const endsAtMs = Date.parse(endsAt);
        if (!Number.isFinite(endsAtMs)) {
            const error = new Error('ends_at must be a valid ISO timestamp');
            error.statusCode = 400;
            throw error;
        }
        if (endsAtMs <= startsAtMs) {
            const error = new Error('ends_at must be later than starts_at');
            error.statusCode = 400;
            throw error;
        }
    }

    return {
        starts_at: startsAt,
        ends_at: endsAt || null
    };
}

module.exports = async function homepageContextHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'homepage.manage' });

        if (req.method === 'GET') {
            const searchParams = getQueryParams(req);
            const site = normalizeHomepageSite(searchParams.get('site') || req.adminSite);
            const payload = await buildHomepageContextPayload(supabase, site);
            return sendJson(res, 200, payload);
        }

        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action, 80).toLowerCase();
        const site = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });

        if (action === 'save_template') {
            const publishedRows = await loadPublishedHomepageRows(supabase, site);
            const draft = await loadHomepageDraft(supabase, site);
            const sourceRows = draft?.sections ? mergeHomepageDraftRows(publishedRows, draft.sections) : publishedRows;
            const template = await insertHomepageTemplate(
                supabase,
                site,
                body,
                buildHomepageReleasePayload(sourceRows),
                user?.id
            );

            await writeAdminAuditLog({
                supabase,
                adminId: user?.id,
                module: 'homepage',
                site,
                actionType: 'homepage.template.save',
                details: {
                    template_id: template.id || null,
                    name: template.name || ''
                }
            });

            return sendJson(res, 200, {
                ...(await buildHomepageContextPayload(supabase, site)),
                template
            });
        }

        if (action === 'apply_template') {
            const templateId = Number.parseInt(body.template_id || body.templateId, 10);
            if (!Number.isFinite(templateId)) {
                return sendJson(res, 400, { success: false, message: 'template_id is required' });
            }

            const template = await loadHomepageTemplateById(supabase, site, templateId);
            if (!template?.payload) {
                return sendJson(res, 404, { success: false, message: '未找到可应用的首页模板' });
            }

            const publishedRows = await loadPublishedHomepageRows(supabase, site);
            const draftRows = parseHomepageReleasePayload(template.payload, site, publishedRows);
            const nextSections = {};
            draftRows.forEach((row) => {
                nextSections[row.section] = {
                    content: row.content,
                    is_visible: row.is_visible !== false,
                    display_order: row.display_order
                };
            });

            await upsertHomepageDraft(supabase, site, nextSections, user?.id);

            await writeAdminAuditLog({
                supabase,
                adminId: user?.id,
                module: 'homepage',
                site,
                actionType: 'homepage.template.apply',
                details: {
                    template_id: template.id || null,
                    name: template.name || ''
                }
            });

            return sendJson(res, 200, {
                ...(await buildHomepageContextPayload(supabase, site)),
                template
            });
        }

        if (action === 'schedule_publish') {
            const { starts_at, ends_at } = validateScheduleWindow(body);
            const publishedRows = await loadPublishedHomepageRows(supabase, site);
            const draft = await loadHomepageDraft(supabase, site);
            const sourceRows = draft?.sections ? mergeHomepageDraftRows(publishedRows, draft.sections) : publishedRows;
            const health = await buildHomepageHealth(supabase, site, sourceRows);
            if (health.error_count > 0) {
                return sendJson(res, 400, {
                    success: false,
                    message: '当前草稿存在阻塞问题，无法创建定时发布',
                    health
                });
            }

            const schedule = await insertHomepageSchedule(
                supabase,
                site,
                {
                    ...body,
                    starts_at,
                    ends_at
                },
                buildHomepageReleasePayload(sourceRows),
                user?.id
            );

            await writeAdminAuditLog({
                supabase,
                adminId: user?.id,
                module: 'homepage',
                site,
                actionType: 'homepage.schedule.create',
                details: {
                    schedule_id: schedule.id || null,
                    starts_at,
                    ends_at
                }
            });

            return sendJson(res, 200, {
                ...(await buildHomepageContextPayload(supabase, site)),
                schedule,
                health
            });
        }

        if (action === 'save_experiment') {
            const payload = await saveHomepageExperimentMutation(supabase, site, body, user?.id);
            return sendJson(res, 200, payload);
        }

        if (action === 'delete_experiment') {
            const payload = await deleteHomepageExperimentMutation(supabase, site, body, user?.id);
            return sendJson(res, 200, payload);
        }

        if (action === 'apply_experiment_winner') {
            const payload = await applyHomepageExperimentWinnerMutation(supabase, site, body, user?.id);
            return sendJson(res, 200, payload);
        }

        if (action === 'apply_recommendation') {
            const payload = await applyHomepageRecommendationMutation(supabase, site, body, user?.id);
            return sendJson(res, 200, payload);
        }

        if (action === 'apply_theme_pack') {
            const payload = await applyHomepageThemePackMutation(supabase, site, body, user?.id);
            return sendJson(res, 200, payload);
        }

        if (action === 'cancel_schedule') {
            const scheduleId = Number.parseInt(body.schedule_id || body.scheduleId, 10);
            if (!Number.isFinite(scheduleId)) {
                return sendJson(res, 400, { success: false, message: 'schedule_id is required' });
            }

            const schedule = await cancelHomepageSchedule(supabase, site, scheduleId);

            await writeAdminAuditLog({
                supabase,
                adminId: user?.id,
                module: 'homepage',
                site,
                actionType: 'homepage.schedule.cancel',
                details: {
                    schedule_id: scheduleId
                }
            });

            return sendJson(res, 200, {
                ...(await buildHomepageContextPayload(supabase, site)),
                schedule
            });
        }

        return sendJson(res, 400, {
            success: false,
            message: 'Unsupported homepage context action'
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load homepage orchestration context'
        });
    }
};
