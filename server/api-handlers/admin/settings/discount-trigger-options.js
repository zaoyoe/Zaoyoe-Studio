const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    buildDiscountLifecycleSummary
} = require('../discounts/_shared');

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function matchesSite(applicableSite = 'all', site = 'all') {
    const normalizedApplicableSite = normalizeSite(applicableSite);
    const normalizedSite = normalizeSite(site);
    return normalizedSite === 'all'
        || normalizedApplicableSite === 'all'
        || normalizedApplicableSite === normalizedSite;
}

module.exports = async (req, res) => {
    try {
        const { supabase } = await requireAdmin(req, { permission: 'settings.manage' });
        const url = new URL(req.url || '', 'http://localhost');
        const site = normalizeSite(url.searchParams.get('site'));

        const { data, error } = await supabase
            .from('discount_codes')
            .select('id, code, applicable_site, discount_type, discount_value, distribution_mode, is_active, starts_at, expires_at, lifecycle_status, status_reason, created_at')
            .eq('distribution_mode', 'user_assigned')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        const rows = (Array.isArray(data) ? data : [])
            .filter((row) => matchesSite(row?.applicable_site, site))
            .map((row) => ({
                id: row.id,
                code: normalizeText(row.code, 160).toUpperCase(),
                applicable_site: normalizeSite(row.applicable_site),
                discount_type: normalizeText(row.discount_type, 40).toLowerCase() || 'fixed',
                discount_value: Number.isFinite(Number(row.discount_value)) ? Number(row.discount_value) : 0,
                distribution_mode: normalizeText(row.distribution_mode, 40).toLowerCase() || 'user_assigned',
                lifecycle_status: normalizeText(row.lifecycle_status, 60).toLowerCase() || null,
                lifecycle_summary: buildDiscountLifecycleSummary(row, { now: new Date() })
            }));

        return sendJson(res, 200, {
            success: true,
            site,
            rows
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load discount trigger options'
        });
    }
};
