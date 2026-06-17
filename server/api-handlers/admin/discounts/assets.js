const {
    getSupabaseAdmin,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    notifyUsers
} = require('../../../../api/_lib/admin-notifications');
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

function normalizeTagTokens(value) {
    const rawValues = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,;]+/);

    return [...new Set(rawValues.map((item) => normalizeText(item, 120)).filter(Boolean))];
}

function formatDiscountBenefitLabel(discount = {}) {
    const discountType = normalizeText(discount?.discount_type, 20).toLowerCase();
    const discountValue = Number(discount?.discount_value);

    if (discountType === 'percent') {
        const folded = discountValue / 10;
        if (Number.isFinite(folded) && folded >= 0) {
            const display = Number.isInteger(folded)
                ? String(folded)
                : folded.toFixed(1).replace(/\.0$/, '');
            return `${display}折`;
        }
        return '折扣券';
    }

    if (discountType === 'fixed') {
        return Number.isFinite(discountValue) && discountValue > 0
            ? `立减 ${discountValue} 积分`
            : '立减券';
    }

    return normalizeText(discount?.code, 80) || '优惠券';
}

function formatDiscountExpiryLine(discount = {}) {
    const expiresAt = normalizeOptionalIsoDate(discount?.expires_at);
    return expiresAt ? `有效期至 ${expiresAt}` : '长期有效';
}

function buildDiscountAssignedNotification(discount = {}) {
    const benefitLabel = formatDiscountBenefitLabel(discount);
    const code = normalizeText(discount?.code, 80);
    const expiryLine = formatDiscountExpiryLine(discount);

    return {
        title: '优惠券已到账',
        content: `${benefitLabel}${code ? `（${code}）` : ''} 已发放到你的钱包卡券。\n${expiryLine}。\n请前往“我的钱包 > 卡券”查看，并在下单时点击使用。`,
        type: 'success',
        scope: 'user_personal',
        category: 'discount_notice',
        actionLabel: '去商城使用',
        actionUrl: '/shop.html',
        sourceModule: 'discounts',
        sourceEventId: `discount_assigned:${normalizeText(discount?.id, 120) || code}`,
        priority: 45,
        metadata: {
            page_id: 'shop',
            event_type: 'coupon_available',
            action_path_label: '我的钱包 > 卡券',
            action_path_url: 'wallet://cards',
            action_path_kind: 'wallet',
            wallet_view: 'cards',
            discount_id: normalizeText(discount?.id, 120),
            discount_code: code,
            benefit_label: benefitLabel,
            expires_at: normalizeOptionalIsoDate(discount?.expires_at)
        },
        dedupeWindowMinutes: 0
    };
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

async function fetchAuthUsersByEmail(adminSupabase, values = []) {
    const normalizedEmails = [...new Set((Array.isArray(values) ? values : [])
        .map((item) => normalizeText(item, 255).toLowerCase())
        .filter(Boolean))];
    if (!normalizedEmails.length || !adminSupabase?.auth?.admin?.listUsers) {
        return [];
    }

    const matchedUsers = new Map();
    let page = 1;
    const perPage = 200;

    while (true) {
        const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage });
        if (error) {
            throw error;
        }

        const users = Array.isArray(data?.users) ? data.users : [];
        users.forEach((user) => {
            const email = normalizeText(user?.email, 255).toLowerCase();
            const userId = normalizeText(user?.id, 160);
            if (!email || !userId || !normalizedEmails.includes(email)) {
                return;
            }

            matchedUsers.set(userId, {
                id: userId,
                username: normalizeText(user?.user_metadata?.username, 120)
                    || normalizeText(user?.user_metadata?.user_name, 120)
                    || null,
                display_name: normalizeText(user?.user_metadata?.display_name, 120)
                    || normalizeText(user?.user_metadata?.full_name, 120)
                    || null,
                email: email || null
            });
        });

        if (users.length < perPage || matchedUsers.size >= normalizedEmails.length) {
            break;
        }
        page += 1;
    }

    return Array.from(matchedUsers.values());
}

async function resolveRecipientProfiles(supabase, tokens = [], adminSupabase = null) {
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

    let authEmailRows = [];
    const matchedProfileEmailSet = new Set(emailRows.map((row) => normalizeText(row?.email, 255).toLowerCase()).filter(Boolean));
    const unresolvedEmailTokens = emailTokens.filter((value) => !matchedProfileEmailSet.has(normalizeText(value, 255).toLowerCase()));
    if (unresolvedEmailTokens.length) {
        try {
            authEmailRows = await fetchAuthUsersByEmail(adminSupabase, unresolvedEmailTokens);
        } catch (_) {
            authEmailRows = [];
        }
    }

    const profileMap = new Map();
    [...rows, ...emailRows, ...authEmailRows].forEach((row) => {
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

async function resolveProfilesByTags(supabase, tags = []) {
    const normalizedTags = normalizeTagTokens(tags);
    if (!normalizedTags.length) {
        return {
            profiles: [],
            matchedTags: [],
            unresolvedTags: []
        };
    }

    const { data, error } = await supabase
        .from('user_tags')
        .select('user_id, tag')
        .in('tag', normalizedTags);

    if (error) {
        throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const matchedTags = [...new Set(rows.map((row) => normalizeText(row?.tag, 120)).filter(Boolean))];
    const userIds = [...new Set(rows.map((row) => normalizeText(row?.user_id, 160)).filter(Boolean))];
    const profiles = await fetchProfilesByField(supabase, 'id', userIds);

    return {
        profiles,
        matchedTags,
        unresolvedTags: normalizedTags.filter((tag) => !matchedTags.includes(tag))
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
        let adminSupabase = null;
        try {
            adminSupabase = getSupabaseAdmin();
        } catch (_) {
            adminSupabase = null;
        }
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

        const directResult = await resolveRecipientProfiles(
            supabase,
            body.user_ids || body.userIds || body.recipients || body.recipient_tokens,
            adminSupabase
        );
        const tagResult = await resolveProfilesByTags(
            supabase,
            body.recipient_tags || body.recipientTags || body.user_tags || body.userTags
        );
        const profileMap = new Map();
        [...directResult.profiles, ...tagResult.profiles].forEach((profile) => {
            const userId = normalizeText(profile?.id, 160);
            if (!userId) return;
            profileMap.set(userId, profile);
        });
        const profiles = Array.from(profileMap.values());
        const unresolved = [
            ...directResult.unresolved,
            ...tagResult.unresolvedTags.map((tag) => `tag:${tag}`)
        ];

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

        let assignmentNotification = {
            recipients: 0,
            created: 0,
            skipped: 0
        };
        let assignmentNotificationWarning = null;
        if (insertedRows.length) {
            try {
                assignmentNotification = await notifyUsers(supabase, {
                    userIds: insertedRows.map((row) => normalizeText(row?.user_id, 160)).filter(Boolean),
                    ...buildDiscountAssignedNotification(discount)
                });
            } catch (notificationError) {
                assignmentNotificationWarning = normalizeText(notificationError?.message, 240) || '发券通知发送失败';
                console.warn('[AdminAPI] Failed to notify assigned discount recipients:', assignmentNotificationWarning);
            }
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
                assignment_notification_created: Number(assignmentNotification?.created || 0),
                assignment_notification_skipped: Number(assignmentNotification?.skipped || 0),
                assignment_notification_warning: assignmentNotificationWarning,
                recipient_tags: normalizeTagTokens(body.recipient_tags || body.recipientTags || body.user_tags || body.userTags),
                unresolved_tag_tokens: tagResult.unresolvedTags,
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
            assignment_notification_created: Number(assignmentNotification?.created || 0),
            assignment_notification_skipped: Number(assignmentNotification?.skipped || 0),
            assignment_notification_warning: assignmentNotificationWarning,
            recipient_tags: normalizeTagTokens(body.recipient_tags || body.recipientTags || body.user_tags || body.userTags),
            unresolved_tags: tagResult.unresolvedTags,
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
