const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const BATCH_SELECT_FIELDS = [
    'id',
    'name',
    'site',
    'package_id',
    'channel',
    'total_count',
    'used_count',
    'expires_at',
    'notes',
    'custom_points_amount',
    'created_at'
].join(', ');

const CODE_SELECT_FIELDS = [
    'id',
    'code',
    'site',
    'batch_id',
    'package_id',
    'status',
    'created_at',
    'used_at',
    'used_by',
    'external_order_id',
    'revoke_reason',
    'revoked_at',
    'revoked_by',
    'expires_at'
].join(', ');

const PACKAGE_SELECT_FIELDS = [
    'id',
    'name',
    'points_amount'
].join(', ');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeString(value) {
    return String(value || '').trim();
}

async function loadPackagesByIds(supabase, packageIds = []) {
    const ids = [...new Set(
        (Array.isArray(packageIds) ? packageIds : [])
            .map((item) => normalizeString(item))
            .filter(Boolean)
    )];

    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('points_packages')
        .select(PACKAGE_SELECT_FIELDS)
        .in('id', ids);

    if (error) throw error;

    return new Map(
        (data || []).map((row) => [normalizeString(row?.id), row])
    );
}

async function loadProfilesByIds(supabase, profileIds = []) {
    const ids = [...new Set(
        (Array.isArray(profileIds) ? profileIds : [])
            .map((item) => normalizeString(item))
            .filter(Boolean)
    )];

    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, email')
        .in('id', ids);

    if (error) throw error;

    return new Map(
        (data || []).map((row) => [normalizeString(row?.id), row])
    );
}

async function loadBatchRows(supabase, site) {
    let query = supabase
        .from('redemption_batches')
        .select(BATCH_SELECT_FIELDS);

    if (site !== 'all') {
        query = query.eq('site', site);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    const rows = data || [];
    const packageMap = await loadPackagesByIds(supabase, rows.map((row) => row.package_id));

    return rows.map((row) => ({
        ...row,
        points_packages: packageMap.get(normalizeString(row?.package_id)) || null
    }));
}

async function loadBatchById(supabase, site, batchId) {
    const normalizedId = normalizeString(batchId);
    if (!normalizedId) {
        const error = new Error('batchId is required');
        error.statusCode = 400;
        throw error;
    }

    let query = supabase
        .from('redemption_batches')
        .select(BATCH_SELECT_FIELDS)
        .eq('id', normalizedId);

    if (site !== 'all') {
        query = query.eq('site', site);
    }

    const { data, error } = await query.single();

    if (error) {
        if (error.code === 'PGRST116') {
            const notFoundError = new Error('Batch not found');
            notFoundError.statusCode = 404;
            throw notFoundError;
        }
        throw error;
    }

    const packageMap = await loadPackagesByIds(supabase, [data?.package_id]);
    return {
        ...data,
        points_packages: packageMap.get(normalizeString(data?.package_id)) || null
    };
}

async function loadBatchCodes(supabase, batch) {
    const { data, error } = await supabase
        .from('redemption_codes')
        .select(CODE_SELECT_FIELDS)
        .eq('batch_id', batch.id)
        .eq('site', batch.site)
        .order('created_at');

    if (error) throw error;

    const codeRows = data || [];
    const profileIds = [
        ...codeRows.map((row) => row.used_by),
        ...codeRows.map((row) => row.revoked_by)
    ];
    const profileMap = await loadProfilesByIds(supabase, profileIds);

    return codeRows.map((row) => ({
        ...row,
        used_profile: profileMap.get(normalizeString(row?.used_by)) || null,
        revoker_name: (() => {
            const profile = profileMap.get(normalizeString(row?.revoked_by));
            return profile ? (profile.username || profile.email || '未知') : '';
        })()
    }));
}

async function loadBatchByCode(supabase, site, code) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) {
        const error = new Error('code is required');
        error.statusCode = 400;
        throw error;
    }

    let query = supabase
        .from('redemption_codes')
        .select('batch_id, site')
        .eq('code', normalizedCode);

    if (site !== 'all') {
        query = query.eq('site', site);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    if (!data?.batch_id) {
        return null;
    }

    return loadBatchById(supabase, site === 'all' ? normalizeSite(data.site) : site, data.batch_id);
}

module.exports = async (req, res) => {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'points.manage' });
        const searchParams = getSearchParams(req);
        const site = normalizeSite(searchParams.get('site') || req.adminSite);
        const batchId = normalizeString(searchParams.get('batchId'));
        const code = normalizeCode(searchParams.get('code'));

        if (batchId) {
            const batch = await loadBatchById(supabase, site, batchId);
            const codes = await loadBatchCodes(supabase, batch);
            return sendJson(res, 200, {
                success: true,
                site,
                batch,
                codes
            });
        }

        if (code) {
            const batch = await loadBatchByCode(supabase, site, code);
            return sendJson(res, 200, {
                success: true,
                site,
                found: Boolean(batch),
                batch
            });
        }

        const batches = await loadBatchRows(supabase, site);
        return sendJson(res, 200, {
            success: true,
            site,
            batches
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Points batches request failed'
        });
    }
};
