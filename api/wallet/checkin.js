const admin = require('../_lib/admin');
const site = require('../_lib/site');
const {
    maybeIssueCheckinDiscountAssets
} = require('../_lib/discount-trigger-linkage');

function normalizeCheckinDate(value) {
    const normalized = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

module.exports = async function walletCheckinHandler(req, res) {
    const {
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin;
    const {
        requireSupportedSite
    } = site;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const {
            user,
            requestSupabase,
            adminSupabase,
            supabase
        } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);
        const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
        const client = requestSupabase || supabase;

        if (!client?.rpc) {
            return sendJson(res, 503, {
                success: false,
                message: '签到服务暂时不可用'
            });
        }

        const { data, error } = await client.rpc('fn_daily_checkin_v2', {
            p_user_id: user.id,
            p_site: currentSite
        });

        if (error) {
            throw error;
        }

        let linkedDiscountSummary = null;
        if (data?.success && !data?.already_checked && (adminSupabase?.from || supabase?.from)) {
            linkedDiscountSummary = await maybeIssueCheckinDiscountAssets({
                supabase: adminSupabase || supabase,
                userId: user.id,
                site: currentSite,
                checkinDate: normalizeCheckinDate(body?.checkin_date || body?.checkinDate || body?.local_date || body?.localDate),
                pointsReward: data?.points,
                baseReward: data?.base_reward,
                bonusReward: data?.bonus_reward,
                streakDays: data?.consecutive_days
            });
        }

        return sendJson(res, 200, {
            ...(data && typeof data === 'object' ? data : { success: false, message: '签到失败' }),
            linked_discount_summary: linkedDiscountSummary
        });
    } catch (error) {
        return admin.sendJson(res, error?.statusCode || 500, {
            success: false,
            message: error?.message || '签到失败'
        });
    }
};
