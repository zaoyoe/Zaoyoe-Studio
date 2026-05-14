const {
    fetchDirectVerifyQuotaState,
    loadVerifyRuntimeConfig
} = require('../_verify-provider-runtime');
const {
    SITE_LAYOUT_CONFIG_KEY,
    SITE_LAYOUT_PAGE_OPTIONS,
    normalizeSiteLayouts,
    normalizeSiteLayoutSite
} = require('../_site-layout');
const {
    PUBLIC_SITE_SYSTEM_CONFIG_KEYS,
    isPublicSiteSystemConfigKey,
    resolveSiteScopedSystemConfigForRead,
    resolveSiteScopedSystemConfigRequestSite
} = require('../_site-scoped-system-config');

function createPublicConfigHandlers({
    admin
} = {}) {
    const {
        getOptionalSupabaseAdmin,
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin || {};

    function sanitizeText(value, maxLength = 4000) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function uniqueValues(values = []) {
        return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
    }

    function normalizeAnnouncementPages(value) {
        const pages = uniqueValues(
            (Array.isArray(value) ? value : [value])
                .map((entry) => sanitizeText(entry, 80).toLowerCase())
                .map((entry) => {
                    if (entry === 'home' || entry === 'homepage' || entry === '/') {
                        return 'index';
                    }
                    return entry;
                })
                .filter(Boolean)
        );

        if (!pages.length || pages.includes('all')) {
            return ['all'];
        }

        return pages;
    }

    function normalizeAnnouncementPageOverrides(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        const overrides = {};

        Object.entries(source).forEach(([rawPage, rawConfig]) => {
            const page = normalizeAnnouncementPages([rawPage])[0];
            if (!page || page === 'all') {
                return;
            }

            const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
                ? rawConfig
                : { content: rawConfig };
            const content = String(config.content ?? config.announcement_content ?? '').slice(0, 12000);
            if (!content.trim() && config.enabled !== false) {
                return;
            }

            overrides[page] = {
                enabled: config.enabled !== false,
                content,
                updated_at: sanitizeText(config.updated_at || config.announcement_updated_at, 120)
            };
        });

        return overrides;
    }

    function sanitizeAnnouncementConfig(configValue = {}) {
        const config = configValue && typeof configValue === 'object' && !Array.isArray(configValue)
            ? configValue
            : {};

        return {
            announcement_enabled: config.announcement_enabled === true,
            announcement_content: String(config.announcement_content || '').slice(0, 12000),
            announcement_type: sanitizeText(config.announcement_type, 80).toLowerCase() || 'banner',
            announcement_color: sanitizeText(config.announcement_color, 80).toLowerCase() || 'purple',
            announcement_size: sanitizeText(config.announcement_size, 80).toLowerCase() || 'medium',
            announcement_decoration: sanitizeText(config.announcement_decoration, 80).toLowerCase() || 'none',
            announcement_pages: normalizeAnnouncementPages(config.announcement_pages),
            announcement_page_overrides: normalizeAnnouncementPageOverrides(config.announcement_page_overrides),
            announcement_updated_at: sanitizeText(config.announcement_updated_at, 120)
        };
    }

    function isMissingAnnouncementTableError(error) {
        const text = [
            error?.code,
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ');
        return error?.code === '42P01'
            || error?.code === 'PGRST205'
            || /could not find the table .*announcement_(rules|reads)/i.test(text)
            || /relation .*announcement_(rules|reads).* does not exist/i.test(text)
            || (/schema cache/i.test(text) && /announcement_(rules|reads)/i.test(text));
    }

    function isMissingAnnouncementSiteColumnError(error) {
        const text = [
            error?.code,
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ');
        return error?.code === '42703'
            || /column .*site.* does not exist/i.test(text)
            || /could not find .*site.*announcement_rules/i.test(text)
            || (/schema cache/i.test(text) && /announcement_rules/i.test(text) && /site/i.test(text));
    }

    function normalizeAnnouncementSite(value = '') {
        return String(value || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
    }

    function filterAnnouncementRulesBySite(rows = [], site = 'cn') {
        const normalizedSite = normalizeAnnouncementSite(site);
        return rows.filter((row) => normalizeAnnouncementSite(row.site || 'cn') === normalizedSite);
    }

    function normalizeAnnouncementRule(row = {}) {
        return {
            id: sanitizeText(row.id, 120),
            site: normalizeAnnouncementSite(row.site || 'cn'),
            title: sanitizeText(row.title || '站内公告', 160) || '站内公告',
            announcement_enabled: row.enabled === true,
            announcement_content: String(row.content || '').slice(0, 12000),
            announcement_type: sanitizeText(row.type, 80).toLowerCase() || 'banner',
            announcement_color: sanitizeText(row.color, 80).toLowerCase() || 'purple',
            announcement_size: sanitizeText(row.size, 80).toLowerCase() || 'medium',
            announcement_decoration: sanitizeText(row.decoration, 80).toLowerCase() || 'none',
            announcement_pages: normalizeAnnouncementPages(row.pages),
            announcement_page_overrides: normalizeAnnouncementPageOverrides(row.page_overrides),
            priority: Number(row.priority || 0),
            status: sanitizeText(row.status, 80).toLowerCase() || 'draft',
            starts_at: sanitizeText(row.starts_at, 120),
            ends_at: sanitizeText(row.ends_at, 120),
            announcement_updated_at: sanitizeText(row.updated_at, 120)
        };
    }

    function isAnnouncementRuleCurrentlyVisible(rule = {}, now = new Date()) {
        if (rule.announcement_enabled !== true || rule.status !== 'approved') {
            return false;
        }
        if (!rule.announcement_content && !Object.keys(rule.announcement_page_overrides || {}).length) {
            return false;
        }
        const startsAt = rule.starts_at ? new Date(rule.starts_at) : null;
        const endsAt = rule.ends_at ? new Date(rule.ends_at) : null;
        if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > now) {
            return false;
        }
        if (endsAt && !Number.isNaN(endsAt.getTime()) && endsAt <= now) {
            return false;
        }
        return true;
    }

    async function fetchPublicAnnouncementRules(supabase, site = 'cn') {
        const normalizedSite = normalizeAnnouncementSite(site);
        const buildQuery = (withSiteFilter = true) => {
            let query = supabase
                .from('announcement_rules')
                .select('*')
                .eq('enabled', true)
                .eq('status', 'approved');

            if (withSiteFilter) {
                query = query.eq('site', normalizedSite);
            }

            return query
                .order('priority', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(50);
        };

        let { data, error } = await buildQuery(true);
        let usedLegacyFallback = false;
        if (error && isMissingAnnouncementSiteColumnError(error)) {
            ({ data, error } = await buildQuery(false));
            usedLegacyFallback = true;
        }

        if (error) {
            if (isMissingAnnouncementTableError(error)) {
                return [];
            }
            throw error;
        }

        const now = new Date();
        const rows = usedLegacyFallback
            ? filterAnnouncementRulesBySite(Array.isArray(data) ? data : [], normalizedSite)
            : (Array.isArray(data) ? data : []);
        return rows
            .map(normalizeAnnouncementRule)
            .filter((rule) => isAnnouncementRuleCurrentlyVisible(rule, now));
    }

    async function notificationsHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;

        if (!supabase) {
            return sendJson(res, 503, {
                success: false,
                message: 'Public config is unavailable'
            });
        }

        const url = new URL(req.url || '', 'http://localhost');
        const site = resolveSiteScopedSystemConfigRequestSite(req, url, { fallback: 'cn' });
        const [{ data, error }, rules] = await Promise.all([
            supabase
                .from('system_config')
                .select('config_value')
                .eq('config_key', 'notifications')
                .maybeSingle(),
            fetchPublicAnnouncementRules(supabase, site)
        ]);

        if (error) {
            throw error;
        }

        const config = sanitizeAnnouncementConfig(
            resolveSiteScopedSystemConfigForRead('notifications', data?.config_value || {}, site) || {}
        );
        config.announcement_rules = rules;

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, {
            success: true,
            key: 'notifications',
            site,
            config
        });
    }

    async function siteLayoutHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;

        if (!supabase) {
            return sendJson(res, 503, {
                success: false,
                message: 'Site layout config is unavailable'
            });
        }

        const url = new URL(req.url || '', 'http://localhost');
        const requestedSite = normalizeSiteLayoutSite(url.searchParams.get('site'));
        const query = supabase
            .from('system_config')
            .select('config_value, updated_at')
            .eq('config_key', SITE_LAYOUT_CONFIG_KEY);
        const { data, error } = await (typeof query.maybeSingle === 'function'
            ? query.maybeSingle()
            : query.single());

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        const layouts = normalizeSiteLayouts(data?.config_value);

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, {
            success: true,
            site: requestedSite,
            layout: layouts[requestedSite],
            layouts,
            page_options: SITE_LAYOUT_PAGE_OPTIONS,
            updated_at: data?.updated_at || null
        });
    }

    async function siteSystemConfigHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;

        if (!supabase) {
            return sendJson(res, 503, {
                success: false,
                message: 'Site system config is unavailable'
            });
        }

        const url = new URL(req.url || '', 'http://localhost');
        const site = resolveSiteScopedSystemConfigRequestSite(req, url, { fallback: 'cn' });
        const requestedKeys = Array.from(new Set(
            url.searchParams
                .getAll('key')
                .map((entry) => sanitizeText(entry, 120))
                .filter((key) => isPublicSiteSystemConfigKey(key))
        ));
        const keys = requestedKeys.length
            ? requestedKeys
            : Array.from(PUBLIC_SITE_SYSTEM_CONFIG_KEYS);
        const { data, error } = await supabase
            .from('system_config')
            .select('config_key, config_value, updated_at')
            .in('config_key', keys)
            .order('config_key', { ascending: true });

        if (error) {
            throw error;
        }

        const configs = {};
        let updatedAt = null;

        (Array.isArray(data) ? data : []).forEach((row) => {
            configs[row.config_key] = resolveSiteScopedSystemConfigForRead(
                row.config_key,
                row.config_value,
                site
            );
            if (!updatedAt || String(row.updated_at || '') > String(updatedAt || '')) {
                updatedAt = row.updated_at || updatedAt;
            }
        });

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, {
            success: true,
            site,
            keys,
            configs,
            updated_at: updatedAt
        });
    }

    async function announcementEventHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;

        if (!supabase) {
            return sendJson(res, 202, {
                success: true,
                recorded: false,
                message: 'Announcement event storage is unavailable'
            });
        }

        const body = typeof parseJsonBody === 'function' ? await parseJsonBody(req) : (req.body || {});
        const eventUrl = new URL(req.url || '', 'http://localhost');
        if (body.site) {
            eventUrl.searchParams.set('site', body.site);
        }
        const site = resolveSiteScopedSystemConfigRequestSite(req, eventUrl, { fallback: 'cn' });
        const announcementId = sanitizeText(body.announcement_id || body.id, 120);
        const readerKey = sanitizeText(body.reader_key, 160);
        const eventType = sanitizeText(body.event_type || 'read', 40).toLowerCase();

        if (!announcementId || !readerKey || !['view', 'read', 'dismiss'].includes(eventType)) {
            return sendJson(res, 400, {
                success: false,
                message: 'Invalid announcement event'
            });
        }

        const payload = {
            announcement_id: announcementId,
            reader_key: readerKey,
            page: normalizeAnnouncementPages(body.page || 'unknown')[0] || 'unknown',
            event_type: eventType,
            ack_key: sanitizeText(body.ack_key, 240),
            user_agent: sanitizeText(req.headers?.['user-agent'] || req.headers?.['User-Agent'], 500),
            metadata: {
                ...(body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
                    ? body.metadata
                    : {}),
                site
            }
        };

        const { error } = await supabase
            .from('announcement_reads')
            .upsert(payload, {
                onConflict: 'announcement_id,reader_key,page,event_type',
                ignoreDuplicates: true
            });

        if (error) {
            if (isMissingAnnouncementTableError(error)) {
                return sendJson(res, 202, {
                    success: true,
                    recorded: false,
                    message: 'Announcement event tables are not migrated yet'
                });
            }
            throw error;
        }

        return sendJson(res, 200, {
            success: true,
            recorded: true
        });
    }

    async function verifyQuotaHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        if (typeof requireAuthenticatedUser !== 'function') {
            return sendJson(res, 503, {
                success: false,
                message: 'Verify quota is unavailable'
            });
        }

        await requireAuthenticatedUser(req);
        const url = new URL(req.url || '', 'http://localhost');
        const site = resolveSiteScopedSystemConfigRequestSite(req, url, { fallback: 'cn' });

        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;

        if (!supabase) {
            return sendJson(res, 503, {
                success: false,
                message: 'Verify quota is unavailable'
            });
        }

        const quotaState = await fetchDirectVerifyQuotaState(supabase, {
            fetchImpl: global.fetch,
            site
        });

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, quotaState?.status || 500, quotaState);
    }

    function sanitizeVerifyPublicSettings(config = {}) {
        const extractPrice = Math.max(
            1,
            Number(config.pricePerVerifyExtract || config.price_per_verify_extract || config.pricePerVerify || config.price_per_verify) || 10
        );
        const fullPrice = Math.max(
            extractPrice,
            Number(config.pricePerVerifyFull || config.price_per_verify_full) || Math.round(extractPrice * 2)
        );

        return {
            enabled: config.enabled !== false,
            price_per_verify: extractPrice,
            price_per_verify_extract: extractPrice,
            price_per_verify_full: fullPrice,
            pricePerVerify: extractPrice,
            pricePerVerifyExtract: extractPrice,
            pricePerVerifyFull: fullPrice
        };
    }

    async function verifySettingsHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const url = new URL(req.url || '', 'http://localhost');
        const site = resolveSiteScopedSystemConfigRequestSite(req, url, { fallback: 'cn' });
        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;
        const config = await loadVerifyRuntimeConfig(supabase, process.env, { site });

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, {
            success: true,
            site: config.site || site,
            config: sanitizeVerifyPublicSettings(config)
        });
    }

    return {
        notifications: async (req, res) => {
            try {
                return await notificationsHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public config request failed'
                });
            }
        },
        'site-layout': async (req, res) => {
            try {
                return await siteLayoutHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public site layout request failed'
                });
            }
        },
        'site-system-config': async (req, res) => {
            try {
                return await siteSystemConfigHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public site system config request failed'
                });
            }
        },
        'announcement-event': async (req, res) => {
            try {
                return await announcementEventHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Announcement event request failed'
                });
            }
        },
        'verify-quota': async (req, res) => {
            try {
                return await verifyQuotaHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public verify quota request failed'
                });
            }
        },
        'verify-settings': async (req, res) => {
            try {
                return await verifySettingsHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public verify settings request failed'
                });
            }
        }
    };
}

module.exports = {
    createPublicConfigHandlers
};
