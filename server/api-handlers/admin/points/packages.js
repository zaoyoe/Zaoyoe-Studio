const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    clearPointsCatalogBaseCache
} = require('./_catalog-base');

const PACKAGE_SELECT_FIELDS = [
    'id',
    'name',
    'name_en',
    'points_amount',
    'bonus_points',
    'price_cny',
    'is_active',
    'sort_order',
    'created_at'
].join(', ');

function normalizeString(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function normalizeOptionalString(value) {
    if (value === undefined) return undefined;
    return String(value ?? '').trim();
}

function normalizeNumber(value, fallback = 0, { min = 0, decimals = null } = {}) {
    const parsed = Number(value);
    let normalized = Number.isFinite(parsed) ? parsed : fallback;
    normalized = Math.max(min, normalized);

    if (decimals === null) {
        return normalized;
    }

    const factor = 10 ** decimals;
    return Math.round(normalized * factor) / factor;
}

function normalizeBoolean(value, fallback = true) {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['false', '0', 'off', 'no'].includes(normalized)) return false;
        if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    }
    return Boolean(value);
}

function normalizePackagePayload(body = {}, { existing = null, action = 'update' } = {}) {
    const isCreate = action === 'create';
    const name = normalizeOptionalString(body.name);
    const payload = {};

    if (name !== undefined || isCreate) {
        const resolvedName = normalizeString(name, existing?.name || '');
        if (!resolvedName) {
            const error = new Error('Package name is required');
            error.statusCode = 400;
            throw error;
        }
        payload.name = resolvedName;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'name_en') || isCreate) {
        payload.name_en = normalizeString(body.name_en, existing?.name_en || '');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'points_amount') || Object.prototype.hasOwnProperty.call(body, 'points') || isCreate) {
        payload.points_amount = normalizeNumber(
            body.points_amount ?? body.points,
            existing?.points_amount ?? 0,
            { min: 0, decimals: 2 }
        );
    }

    if (Object.prototype.hasOwnProperty.call(body, 'bonus_points') || Object.prototype.hasOwnProperty.call(body, 'bonus') || isCreate) {
        payload.bonus_points = normalizeNumber(
            body.bonus_points ?? body.bonus,
            existing?.bonus_points ?? 0,
            { min: 0, decimals: 2 }
        );
    }

    if (Object.prototype.hasOwnProperty.call(body, 'price_cny') || Object.prototype.hasOwnProperty.call(body, 'price') || isCreate) {
        const rawPrice = body.price_cny ?? body.price;
        payload.price_cny = rawPrice === '' || rawPrice == null
            ? null
            : normalizeNumber(rawPrice, existing?.price_cny ?? 0, { min: 0, decimals: 2 });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'is_active') || Object.prototype.hasOwnProperty.call(body, 'enabled') || isCreate) {
        payload.is_active = normalizeBoolean(body.is_active ?? body.enabled, existing?.is_active ?? true);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'sort_order') || Object.prototype.hasOwnProperty.call(body, 'sort') || isCreate) {
        payload.sort_order = Math.round(normalizeNumber(
            body.sort_order ?? body.sort,
            existing?.sort_order ?? 0,
            { min: 0 }
        ));
    }

    return payload;
}

async function loadPackages(supabase) {
    const { data, error } = await supabase
        .from('points_packages')
        .select(PACKAGE_SELECT_FIELDS)
        .order('sort_order', { ascending: true })
        .order('points_amount', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function loadPackageById(supabase, id) {
    const { data, error } = await supabase
        .from('points_packages')
        .select(PACKAGE_SELECT_FIELDS)
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            const notFound = new Error('Package not found');
            notFound.statusCode = 404;
            throw notFound;
        }
        throw error;
    }

    return data;
}

module.exports = async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();

    if (!['GET', 'POST', 'DELETE'].includes(method)) {
        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const accessConfig = { anyOf: ['points.manage', 'settings.manage'] };
        const { supabase, user } = await requireAdmin(req, accessConfig);

        if (method === 'GET') {
            const rows = await loadPackages(supabase);
            return sendJson(res, 200, {
                success: true,
                rows
            });
        }

        const body = await parseJsonBody(req);
        const writableSite = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });

        if (method === 'DELETE') {
            const id = normalizeString(body.id);
            if (!id) {
                return sendJson(res, 400, { success: false, message: 'id is required' });
            }

            const existing = await loadPackageById(supabase, id);
            const { error } = await supabase
                .from('points_packages')
                .delete()
                .eq('id', id);

            if (error) throw error;
            clearPointsCatalogBaseCache();

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'points',
                site: writableSite,
                actionType: 'package.delete',
                details: {
                    package_id: existing.id,
                    package_name: existing.name
                }
            });

            return sendJson(res, 200, {
                success: true,
                id
            });
        }

        const action = normalizeString(body.action || (body.id ? 'update' : 'create'), 'update').toLowerCase();
        if (!['create', 'update'].includes(action)) {
            return sendJson(res, 400, { success: false, message: 'Unsupported package action' });
        }

        if (action === 'create') {
            const existingRows = await loadPackages(supabase);
            const payload = normalizePackagePayload(body, {
                action: 'create',
                existing: { sort_order: existingRows.length + 1 }
            });
            if (!Object.prototype.hasOwnProperty.call(payload, 'sort_order')) {
                payload.sort_order = existingRows.length + 1;
            }

            const { data, error } = await supabase
                .from('points_packages')
                .insert(payload)
                .select(PACKAGE_SELECT_FIELDS)
                .single();

            if (error) throw error;
            clearPointsCatalogBaseCache();

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'points',
                site: writableSite,
                actionType: 'package.create',
                details: {
                    package_id: data.id,
                    package_name: data.name,
                    points_amount: data.points_amount,
                    bonus_points: data.bonus_points,
                    price_cny: data.price_cny
                }
            });

            return sendJson(res, 200, {
                success: true,
                row: data
            });
        }

        const id = normalizeString(body.id);
        if (!id) {
            return sendJson(res, 400, { success: false, message: 'id is required' });
        }

        const existing = await loadPackageById(supabase, id);
        const payload = normalizePackagePayload(body, { existing, action: 'update' });
        const { data, error } = await supabase
            .from('points_packages')
            .update(payload)
            .eq('id', id)
            .select(PACKAGE_SELECT_FIELDS)
            .single();

        if (error) throw error;
        clearPointsCatalogBaseCache();

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'points',
            site: writableSite,
            actionType: 'package.update',
            details: {
                package_id: data.id,
                package_name: data.name,
                updated_fields: Object.keys(payload)
            }
        });

        return sendJson(res, 200, {
            success: true,
            row: data
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Points packages request failed'
        });
    }
};
