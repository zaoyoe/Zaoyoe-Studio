const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const { matchCategoryIconUrl } = require('../../../integrations/suppliers/xiareng/category-groups');

module.exports = async function adminShopCategoriesHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'shop.manage' });
        const { data, error } = await supabase
            .from('shop_categories')
            .select('*')
            .order('sort_order');

        if (error) {
            throw error;
        }

        const existingRows = Array.isArray(data) ? [...data] : [];
        const existingNames = new Set(existingRows.map((r) => String(r.name || '').trim().toLowerCase()));

        // Auto-heal: Check if shop_products has categories that are not yet in shop_categories
        try {
            const { data: productCats } = await supabase
                .from('shop_products')
                .select('category')
                .not('category', 'is', null);

            const missingNames = new Set();
            if (Array.isArray(productCats)) {
                for (const row of productCats) {
                    const cName = String(row.category || '').trim();
                    if (!cName || cName.toLowerCase() === 'all' || cName.toLowerCase() === 'other') continue;
                    if (!existingNames.has(cName.toLowerCase())) {
                        missingNames.add(cName);
                    }
                }
            }

            if (missingNames.size > 0) {
                let currentMaxOrder = existingRows.reduce((max, r) => Math.max(max, Number(r.sort_order || 0)), 0);
                for (const mName of missingNames) {
                    currentMaxOrder += 10;
                    const matchedIcon = matchCategoryIconUrl(mName);
                    const insertPayload = {
                        name: mName,
                        color: '#6b9ece',
                        sort_order: currentMaxOrder,
                        is_public: true,
                        ...(matchedIcon ? { icon_url: matchedIcon } : {})
                    };
                    let insertSuccess = false;
                    try {
                        const { data: inserted, error: insErr } = await supabase
                            .from('shop_categories')
                            .insert(insertPayload)
                            .select('*')
                            .maybeSingle();

                        if (!insErr && inserted) {
                            existingRows.push(inserted);
                            existingNames.add(mName.toLowerCase());
                            insertSuccess = true;
                        } else if (!insErr) {
                            existingRows.push(insertPayload);
                            existingNames.add(mName.toLowerCase());
                            insertSuccess = true;
                        }
                    } catch (_) {}

                    if (!insertSuccess && insertPayload.icon_url) {
                        delete insertPayload.icon_url;
                        try {
                            const { data: insertedFallback, error: fbErr } = await supabase
                                .from('shop_categories')
                                .insert(insertPayload)
                                .select('*')
                                .maybeSingle();
                            if (!fbErr && insertedFallback) {
                                existingRows.push(insertedFallback);
                                existingNames.add(mName.toLowerCase());
                            } else if (!fbErr) {
                                existingRows.push(insertPayload);
                                existingNames.add(mName.toLowerCase());
                            }
                        } catch (_) {}
                    }
                }
            }
        } catch (_) {}

        for (const row of existingRows) {
            const nameLower = String(row.name || '').toLowerCase();
            const isMisassignedAiIcon = row.icon_url && (
                row.icon_url.includes('202608282029589417833') ||
                row.icon_url.includes('202606030325329662693')
            ) && (nameLower.includes('gemini') || nameLower.includes('claude'));

            if ((!row.icon_url || isMisassignedAiIcon) && row.name) {
                const seedIcon = matchCategoryIconUrl(row.name);
                if (seedIcon) {
                    row.icon_url = seedIcon;
                    if (isMisassignedAiIcon && row.id) {
                        try {
                            await supabase.from('shop_categories').update({ icon_url: seedIcon }).eq('id', row.id);
                        } catch (_) {}
                    }
                }
            }
        }

        // Overlay hierarchy from system_config if available
        try {
            let hierarchy = {};
            const { data: configRow, error: cfgErr } = await supabase
                .from('system_config')
                .select('config_value')
                .eq('config_key', 'shop_category_hierarchy')
                .maybeSingle();

            if (!cfgErr && configRow) {
                if (configRow.config_value && typeof configRow.config_value === 'object') {
                    hierarchy = configRow.config_value;
                }
            } else if (cfgErr) {
                try {
                    const { data: fallbackRow } = await supabase
                        .from('system_config')
                        .select('value')
                        .eq('key', 'shop_category_hierarchy')
                        .maybeSingle();
                    if (fallbackRow?.value && typeof fallbackRow.value === 'object') {
                        hierarchy = fallbackRow.value;
                    }
                } catch (_) {}
            }

            for (const row of existingRows) {
                const h = hierarchy[row.id] || hierarchy[row.name];
                if (h) {
                    row.parent_id = row.parent_id || h.parentId || null;
                    row.parent_name = row.parent_name || h.parentName || null;
                } else if (!row.parent_id) {
                    row.parent_id = null;
                    row.parent_name = null;
                }
            }
        } catch (_) {}

        return sendJson(res, 200, {
            success: true,
            rows: existingRows
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load shop categories'
        });
    }
};
