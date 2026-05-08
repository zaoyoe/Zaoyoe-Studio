const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    SITE_LAYOUT_CONFIG_KEY,
    SITE_LAYOUT_PAGE_OPTIONS,
    normalizeSiteLayouts,
    normalizeSiteLayoutRecord,
    normalizeSiteLayoutSite
} = require('../../_site-layout');

function normalizeLayoutReadSite(site) {
    const normalized = normalizeAdminSite(site);
    return normalized === 'intl' || normalized === 'all' ? normalized : 'cn';
}

async function loadSiteLayoutRow(supabase) {
    const query = supabase
        .from('system_config')
        .select('config_value, updated_at')
        .eq('config_key', SITE_LAYOUT_CONFIG_KEY);
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

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const { supabase } = await requireAdmin(req, { permission: 'homepage.manage' });
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeLayoutReadSite(url.searchParams.get('site'));
            const row = await loadSiteLayoutRow(supabase);
            const layouts = normalizeSiteLayouts(row?.config_value);

            return sendJson(res, 200, {
                success: true,
                site,
                layout: site === 'all' ? null : layouts[normalizeSiteLayoutSite(site)],
                layouts,
                page_options: SITE_LAYOUT_PAGE_OPTIONS,
                updated_at: row?.updated_at || null
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { supabase, user } = await requireAdmin(req, { permission: 'homepage.manage' });
        const body = await parseJsonBody(req);
        const site = requireWritableAdminSite(body.site, {
            message: 'Site layout updates require cn or intl'
        });
        const row = await loadSiteLayoutRow(supabase);
        const layouts = normalizeSiteLayouts(row?.config_value);
        layouts[site] = normalizeSiteLayoutRecord(body.layout, site);

        const nextUpdatedAt = new Date().toISOString();
        const { error } = await supabase
            .from('system_config')
            .upsert({
                config_key: SITE_LAYOUT_CONFIG_KEY,
                config_value: layouts,
                updated_by: user.id,
                updated_at: nextUpdatedAt
            }, {
                onConflict: 'config_key'
            });

        if (error) {
            throw error;
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'homepage',
            actionType: 'homepage.site_layout.update',
            details: {
                site,
                layout: layouts[site]
            }
        });

        return sendJson(res, 200, {
            success: true,
            site,
            layout: layouts[site],
            layouts,
            page_options: SITE_LAYOUT_PAGE_OPTIONS,
            updated_at: nextUpdatedAt
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Homepage site layout request failed'
        });
    }
};
