const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    DISCOUNT_SELECT_FIELDS,
    normalizeText,
    normalizeOptionalIsoDate
} = require('./_shared');

function normalizeOptionalSite(value) {
    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized || normalized === 'all' || normalized === 'global') {
        return null;
    }
    return ['cn', 'intl'].includes(normalized) ? normalized : null;
}

async function loadDiscountById(supabase, id) {
    const { data, error } = await supabase
        .from('discount_codes')
        .select(DISCOUNT_SELECT_FIELDS)
        .eq('id', id)
        .single();

    if (error || !data) {
        const notFoundError = new Error(error?.message || '优惠券不存在');
        notFoundError.statusCode = 404;
        throw notFoundError;
    }

    return data;
}

function assertWritableSiteAccessForDiscount(discount, writableSite) {
    const applicableSite = normalizeOptionalSite(discount?.applicable_site);
    if (applicableSite && applicableSite !== writableSite) {
        const error = new Error(`优惠码属于 ${applicableSite.toUpperCase()} 站点，请切换站点后重试`);
        error.statusCode = 409;
        throw error;
    }
}

function normalizeRecipientTokens(value) {
    const rawValues = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,;]+/);

    return [...new Set(rawValues.map((item) => normalizeText(item, 255)).filter(Boolean))];
}

async function fetchProfilesByField(supabase, field, values = []) {
    const normalizedValues = [...new Set((Array.isArray(values) ? values : []).map((item) => normalizeText(item, 255)).filter(Boolean))];
    if (!normalizedValues.length) {
        return [];
    }

    let query = supabase
        .from('profiles')
        .select('id, username, display_name, email')
        .in(field, normalizedValues);

    let data = null;
    let error = null;
    ({ data, error } = await query);

    if (error && field === 'email') {
        ({ data, error } = await supabase
            .from('profiles')
            .select('id, username, display_name')
            .in('id', []));
    }

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function resolveRecipientProfiles(supabase, tokens = []) {
    const values = normalizeRecipientTokens(tokens);
    if (!values.length) {
        return {
            profiles: [],
            unresolved: []
        };
    }

    const idTokens = values.filter((value) => /^[0-9a-f-]{16,}$/i.test(value));
    const emailTokens = values.filter((value) => value.includes('@'));
    const usernameTokens = values.filter((value) => !idTokens.includes(value) && !emailTokens.includes(value));

    const rows = [
        ...await fetchProfilesByField(supabase, 'id', idTokens),
        ...await fetchProfilesByField(supabase, 'username', usernameTokens)
    ];

    let emailRows = [];
    try {
        emailRows = await fetchProfilesByField(supabase, 'email', emailTokens);
    } catch (_) {
        emailRows = [];
    }

    const profileMap = new Map();
    [...rows, ...emailRows].forEach((row) => {
        const id = normalizeText(row?.id, 160);
        if (!id) return;
        profileMap.set(id, row);
    });

    const matchedTokens = new Set();
    for (const profile of profileMap.values()) {
        const id = normalizeText(profile?.id, 255);
        const username = normalizeText(profile?.username, 255);
        const email = normalizeText(profile?.email, 255);
        if (id) matchedTokens.add(id);
        if (username) matchedTokens.add(username);
        if (email) matchedTokens.add(email);
    }

    return {
        profiles: Array.from(profileMap.values()),
        unresolved: values.filter((value) => !matchedTokens.has(value))
    };
}

async function loadExistingAvailableAssets(supabase, discountId, userIds = []) {
    const normalizedIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!normalizedIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('discount_user_assets')
        .select('id, user_id, asset_status')
        .eq('discount_id', discountId)
        .in('user_id', normalizedIds);

    if (error) throw error;

    return new Map((data || [])
        .filter((row) => normalizeText(row?.asset_status, 40).toLowerCase() === 'available')
        .map((row) => [normalizeText(row?.user_id, 160), row]));
}

module.exports = async function adminDiscountAssetsHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'discounts.manage' });
        const body = await parseJsonBody(req);
        const action = normalizeText(body.action, 40).toLowerCase();
        const writableSite = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });

        if (action !== 'assign') {
            return sendJson(res, 400, {
                success: false,
                message: `Unsupported action: ${action || 'unknown'}`
            });
        }

        const discountId = normalizeText(body.discount_id || body.discountId, 160);
        if (!discountId) {
            return sendJson(res, 400, {
                success: false,
                message: 'discount_id is required'
            });
        }

        const discount = await loadDiscountById(supabase, discountId);
        assertWritableSiteAccessForDiscount(discount, writableSite);

        const { profiles, unresolved } = await resolveRecipientProfiles(
            supabase,
            body.user_ids || body.userIds || body.recipients || body.recipient_tokens
        );
        if (!profiles.length) {
            return sendJson(res, 400, {
                success: false,
                message: '没有解析到可发放的用户'
            });
        }

        const preventDuplicates = body.prevent_duplicates !== false && body.preventDuplicates !== false;
        const existingAvailableAssetMap = preventDuplicates
            ? await loadExistingAvailableAssets(supabase, discountId, profiles.map((profile) => profile?.id))
            : new Map();
        const nowIso = new Date().toISOString();
        const sourceChannel = normalizeText(body.source_channel || body.sourceChannel, 80).toLowerCase() || 'manual_admin';
        const audienceSegment = normalizeText(body.audience_segment || body.audienceSegment, 80).toLowerCase()
            || normalizeText(discount?.audience_segment, 80).toLowerCase()
            || 'manual_target';
        const sourceBatchId = normalizeText(body.source_batch_id || body.sourceBatchId, 120)
            || `discount-assign-${Date.now()}`;
        const assetExpiresAt = normalizeOptionalIsoDate(discount?.expires_at);

        const assignedProfiles = [];
        const skippedProfiles = [];
        const insertPayload = [];
        for (const profile of profiles) {
            const userId = normalizeText(profile?.id, 160);
            if (!userId) continue;
            if (existingAvailableAssetMap.has(userId)) {
                skippedProfiles.push({
                    user_id: userId,
                    username: normalizeText(profile?.username, 120) || null,
                    reason: '已有可用卡券'
                });
                continue;
            }

            assignedProfiles.push({
                user_id: userId,
                username: normalizeText(profile?.username, 120) || null
            });
            insertPayload.push({
                discount_id: discountId,
                user_id: userId,
                asset_status: 'available',
                assigned_at: nowIso,
                claimed_at: nowIso,
                expires_at: assetExpiresAt,
                source_type: 'admin_assign',
                source_channel: sourceChannel,
                audience_segment: audienceSegment,
                source_batch_id: sourceBatchId,
                created_by: user.id,
                restored_at: null,
                consumed_at: null,
                last_order_id: null
            });
        }

        let insertedRows = [];
        if (insertPayload.length) {
            const { data, error } = await supabase
                .from('discount_user_assets')
                .insert(insertPayload)
                .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, source_channel, audience_segment, source_batch_id');

            if (error) {
                return sendJson(res, 400, {
                    success: false,
                    message: error.message || '定向发券失败'
                });
            }
            insertedRows = Array.isArray(data) ? data : [];
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'discounts',
            site: writableSite,
            actionType: 'discount.asset.assign',
            details: {
                discount_id: discount.id,
                code: discount.code,
                distribution_mode: discount.distribution_mode || 'general_code',
                source_channel: sourceChannel,
                audience_segment: audienceSegment,
                source_batch_id: sourceBatchId,
                assigned_count: insertedRows.length,
                skipped_count: skippedProfiles.length,
                unresolved_count: unresolved.length,
                recipient_user_ids: insertedRows.map((row) => normalizeText(row?.user_id, 160)).filter(Boolean),
                unresolved_tokens: unresolved
            }
        });

        return sendJson(res, 200, {
            success: true,
            discount_id: discount.id,
            code: discount.code,
            assigned_count: insertedRows.length,
            skipped_count: skippedProfiles.length,
            unresolved_count: unresolved.length,
            assigned: insertedRows,
            skipped: skippedProfiles,
            unresolved
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to assign discount assets'
        });
    }
};
