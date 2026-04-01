const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson
} = require('../../../../api/_lib/admin');

function normalizeHomepageSite(site) {
    return site === 'intl' ? 'intl' : 'cn';
}

function normalizeSection(section) {
    return String(section || '').trim().toLowerCase();
}

function buildHomepageSelectQuery(supabase, site) {
    return supabase
        .from('homepage_config')
        .select('id, site, section, content, is_visible, display_order, updated_at')
        .eq('site', site)
        .order('display_order', { ascending: true });
}

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'homepage.manage' });

        if (req.method === 'GET') {
            const site = normalizeHomepageSite(req.adminSite);
            const { data, error } = await buildHomepageSelectQuery(supabase, site);

            if (error) {
                return sendJson(res, 500, {
                    success: false,
                    message: error.message || '加载首页配置失败'
                });
            }

            return sendJson(res, 200, {
                success: true,
                site,
                rows: data || []
            });
        }

        const body = await parseJsonBody(req);
        const site = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });
        const id = String(body.id || '').trim();
        const section = normalizeSection(body.section);
        const updatePayload = {};

        if (!id) {
            return sendJson(res, 400, { success: false, message: 'id is required' });
        }

        if (!section) {
            return sendJson(res, 400, { success: false, message: 'section is required' });
        }

        if (Object.prototype.hasOwnProperty.call(body, 'content')) {
            if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) {
                return sendJson(res, 400, { success: false, message: 'content must be an object' });
            }
            updatePayload.content = body.content;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'is_visible')) {
            updatePayload.is_visible = body.is_visible !== false;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'display_order')) {
            const parsedOrder = Number.parseInt(body.display_order, 10);
            updatePayload.display_order = Number.isFinite(parsedOrder) ? parsedOrder : 0;
        }

        if (!Object.keys(updatePayload).length) {
            return sendJson(res, 400, { success: false, message: 'No homepage fields to update' });
        }

        const { data, error } = await supabase
            .from('homepage_config')
            .update(updatePayload)
            .eq('id', id)
            .eq('site', site)
            .eq('section', section)
            .select('id, site, section, content, is_visible, display_order, updated_at')
            .single();

        if (error || !data) {
            return sendJson(res, error?.code === 'PGRST116' ? 404 : 400, {
                success: false,
                message: error?.message || '保存首页配置失败'
            });
        }

        return sendJson(res, 200, {
            success: true,
            site,
            row: data
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Homepage config request failed'
        });
    }
};
