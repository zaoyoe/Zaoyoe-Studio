const {
    fetchDirectVerifyQuotaState
} = require('../_verify-provider-runtime');

function createPublicConfigHandlers({
    admin
} = {}) {
    const {
        getOptionalSupabaseAdmin,
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
            announcement_updated_at: sanitizeText(config.announcement_updated_at, 120)
        };
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

        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'notifications')
            .maybeSingle();

        if (error) {
            throw error;
        }

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, {
            success: true,
            key: 'notifications',
            config: sanitizeAnnouncementConfig(data?.config_value || {})
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
            fetchImpl: global.fetch
        });

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, quotaState?.status || 500, quotaState);
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
        'verify-quota': async (req, res) => {
            try {
                return await verifyQuotaHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public verify quota request failed'
                });
            }
        }
    };
}

module.exports = {
    createPublicConfigHandlers
};
