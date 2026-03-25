const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

function normalizePackages(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item, index) => ({
            name: String(item.name || '').trim() || `礼包 ${index + 1}`,
            points: Number(item.points || 0),
            bonus: Number(item.bonus || 0),
            price: Number(item.price || 0),
            enabled: item.enabled !== false,
            sort: Number(item.sort || index + 1)
        }));
}

async function syncPointsPackages(supabase, packages) {
    const normalizedPackages = normalizePackages(packages);
    const { data: existingPackages, error: existingError } = await supabase
        .from('points_packages')
        .select('id, name');

    if (existingError) {
        throw new Error(existingError.message || 'Failed to load existing packages');
    }

    const existingMap = new Map((existingPackages || []).map((item) => [String(item.name || '').trim(), item]));
    const configNames = new Set(normalizedPackages.map((item) => item.name));

    for (const pkg of normalizedPackages) {
        const existing = existingMap.get(pkg.name);
        const packageData = {
            name: pkg.name,
            points_amount: Number.isFinite(pkg.points) ? pkg.points : 0,
            bonus_points: Number.isFinite(pkg.bonus) ? pkg.bonus : 0,
            price_cny: Number.isFinite(pkg.price) ? pkg.price : 0,
            is_active: pkg.enabled !== false,
            sort_order: Number.isFinite(pkg.sort) ? pkg.sort : 0
        };

        const query = existing
            ? supabase.from('points_packages').update(packageData).eq('id', existing.id)
            : supabase.from('points_packages').insert(packageData);
        const { error } = await query;
        if (error) {
            throw new Error(error.message || `Failed to sync package: ${pkg.name}`);
        }
    }

    for (const existing of (existingPackages || [])) {
        const existingName = String(existing.name || '').trim();
        if (!configNames.has(existingName)) {
            const { error } = await supabase
                .from('points_packages')
                .delete()
                .eq('id', existing.id);
            if (error) {
                throw new Error(error.message || `Failed to delete removed package: ${existingName}`);
            }
        }
    }

    return {
        synced_count: normalizedPackages.length,
        removed_count: Math.max(0, (existingPackages || []).length - configNames.size)
    };
}

function sanitizeConfigKey(value) {
    return String(value || '')
        .trim()
        .replace(/[^\w.-]/g, '')
        .slice(0, 120);
}

module.exports = async function systemConfigHandler(req, res) {
    try {
        const method = String(req.method || 'GET').toUpperCase();
        const { user, supabase, adminSupabase } = await requireAdmin(req);
        const db = adminSupabase || supabase;

        if (method === 'GET') {
            const { data, error } = await db
                .from('system_config')
                .select('config_key, config_value')
                .order('config_key', { ascending: true });

            if (error) {
                const dbError = new Error(error.message || 'Failed to load system config');
                dbError.statusCode = 500;
                throw dbError;
            }

            return sendJson(res, 200, {
                success: true,
                items: Array.isArray(data) ? data : []
            });
        }

        if (method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const configKey = sanitizeConfigKey(body?.key);
        const configValue = body?.value;

        if (!configKey) {
            return sendJson(res, 400, {
                success: false,
                message: 'Missing config key'
            });
        }

        const { error: saveError } = await db
            .from('system_config')
            .upsert({
                config_key: configKey,
                config_value: configValue
            }, {
                onConflict: 'config_key'
            });

        if (saveError) {
            const dbError = new Error(saveError.message || 'Failed to save system config');
            dbError.statusCode = 500;
            throw dbError;
        }

        let packageSync = null;
        if (configKey === 'packages') {
            packageSync = await syncPointsPackages(db, configValue);
        }

        await writeAdminAuditLog({
            supabase: db,
            adminId: user.id,
            actionType: 'admin.settings.system_config.update',
            details: {
                config_key: configKey,
                package_sync: packageSync,
                value_kind: Array.isArray(configValue) ? 'array' : typeof configValue
            }
        });

        return sendJson(res, 200, {
            success: true,
            key: configKey,
            package_sync: packageSync
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to handle system config request'
        });
    }
};
