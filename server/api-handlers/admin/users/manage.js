const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { notifyUsers } = require('../../../../api/_lib/admin-notifications');
const { deductPointsForService } = require('../../../../api/_lib/payments/rpc');
const {
    assertNoLockedTargets,
    buildAdminPermissionChangeDetails,
    fetchAdminRoleRowsByUserIds,
    fetchCurrentRoleInfoMap,
    fetchUserProfilesByIds,
    normalizeBoolean,
    normalizeNotificationType,
    normalizeTagValue,
    normalizeUserIds,
    sanitizeText,
    shapeUserRoleInfo,
    uniqueValues
} = require('./_shared');

function createReferenceId(prefix, userId, index = 0) {
    return [
        sanitizeText(prefix, 60).toLowerCase() || 'admin_action',
        sanitizeText(userId, 160),
        Date.now(),
        index
    ].join(':');
}

function requireSingleUserId(body = {}) {
    const userId = sanitizeText(body.userId || body.user_id, 160);
    if (!userId) {
        const error = new Error('userId is required');
        error.statusCode = 400;
        throw error;
    }
    return userId;
}

function requireUserIds(body = {}) {
    const userIds = normalizeUserIds(body.userIds || body.user_ids, body.userId || body.user_id);
    if (!userIds.length) {
        const error = new Error('At least one userId is required');
        error.statusCode = 400;
        throw error;
    }
    return userIds;
}

function requireNonZeroInt(value, fieldName = 'amount') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed === 0) {
        const error = new Error(`${fieldName} must be a non-zero integer`);
        error.statusCode = 400;
        throw error;
    }
    return parsed;
}

function normalizeExpiresAt(value) {
    const raw = sanitizeText(value, 80);
    if (!raw) {
        return null;
    }

    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) {
        const error = new Error('expiresAt must be a valid datetime');
        error.statusCode = 400;
        throw error;
    }

    return parsed.toISOString();
}

async function syncUnlimitedPurchaseEntitlement(supabase, {
    userId,
    enabled,
    adminId
} = {}) {
    if (!userId) {
        return;
    }

    if (enabled) {
        const { error } = await supabase
            .from('user_purchase_entitlements')
            .upsert({
                user_id: userId,
                unlimited_shop_purchases: true,
                updated_at: new Date().toISOString(),
                updated_by: adminId || null
            }, {
                onConflict: 'user_id'
            });

        if (error) {
            throw error;
        }
        return;
    }

    const { error } = await supabase
        .from('user_purchase_entitlements')
        .delete()
        .eq('user_id', userId);

    if (error) {
        throw error;
    }
}

async function upsertAdminRole(supabase, {
    userId,
    permissions,
    expiresAt,
    adminId,
    roleName = 'admin'
} = {}) {
    const payload = {
        user_id: userId,
        role_name: sanitizeText(roleName, 80) || 'admin',
        permissions: uniqueValues((permissions || []).map((permission) => sanitizeText(permission, 120))),
        expires_at: expiresAt || null,
        granted_by: adminId || null,
        granted_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('admin_roles')
        .upsert(payload, {
            onConflict: 'user_id'
        });

    if (error) {
        throw error;
    }
}

async function deleteAdminRole(supabase, userId) {
    const { error } = await supabase
        .from('admin_roles')
        .delete()
        .eq('user_id', userId);

    if (error) {
        throw error;
    }
}

async function fetchCurrentRoleInfo(supabase, userId) {
    const roleInfoMap = await fetchCurrentRoleInfoMap(supabase, [userId]);
    return roleInfoMap.get(userId) || shapeUserRoleInfo(null, null);
}

async function applyAdminPermissionState(supabase, user, userId, formState, {
    actionType = 'update_admin_permissions',
    auditExtras = {},
    roleName = 'admin',
    site = 'all'
} = {}) {
    const previousRoleInfo = await fetchCurrentRoleInfo(supabase, userId);

    if (formState.isAdmin) {
        await upsertAdminRole(supabase, {
            userId,
            permissions: formState.permissions,
            expiresAt: formState.expiresAt || null,
            adminId: user.id,
            roleName
        });
    } else {
        await deleteAdminRole(supabase, userId);
    }

    await syncUnlimitedPurchaseEntitlement(supabase, {
        userId,
        enabled: formState.unlimitedShopPurchases === true,
        adminId: user.id
    });

    const currentRoleInfo = await fetchCurrentRoleInfo(supabase, userId);
    const permissionAudit = buildAdminPermissionChangeDetails(previousRoleInfo, formState, auditExtras);

    if (permissionAudit.hasChanges) {
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: userId,
            module: 'users',
            site,
            actionType,
            details: permissionAudit.details
        });
    }

    return {
        previousRoleInfo,
        currentRoleInfo,
        permissionAudit
    };
}

async function handleGrantAdmin({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const profileMap = await fetchUserProfilesByIds(supabase, [userId]);
    assertNoLockedTargets(profileMap, [userId]);

    const permissions = uniqueValues((body.permissions || ['content.moderate']).map((permission) => sanitizeText(permission, 120)));
    const expiresAt = normalizeExpiresAt(body.expiresAt || body.expires_at);
    const unlimitedShopPurchases = normalizeBoolean(body.unlimitedShopPurchases || body.unlimited_shop_purchases);

    await upsertAdminRole(supabase, {
        userId,
        permissions,
        expiresAt,
        adminId: user.id
    });
    await syncUnlimitedPurchaseEntitlement(supabase, {
        userId,
        enabled: unlimitedShopPurchases,
        adminId: user.id
    });

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: userId,
        module: 'users',
        site,
        actionType: 'grant_admin',
        details: {
            permissions,
            expires_at: expiresAt,
            unlimited_shop_purchases: unlimitedShopPurchases
        }
    });

    return {
        userId,
        roleInfo: await fetchCurrentRoleInfo(supabase, userId)
    };
}

async function handleRevokeAdmin({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const profileMap = await fetchUserProfilesByIds(supabase, [userId]);
    assertNoLockedTargets(profileMap, [userId]);

    await deleteAdminRole(supabase, userId);
    await syncUnlimitedPurchaseEntitlement(supabase, {
        userId,
        enabled: false,
        adminId: user.id
    });

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: userId,
        module: 'users',
        site,
        actionType: 'revoke_admin',
        details: {}
    });

    return {
        userId,
        roleInfo: await fetchCurrentRoleInfo(supabase, userId)
    };
}

async function handleUpdateAdminPermissions({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const profileMap = await fetchUserProfilesByIds(supabase, [userId]);
    assertNoLockedTargets(profileMap, [userId]);

    const formState = {
        isAdmin: normalizeBoolean(body.isAdmin ?? body.is_admin ?? true),
        permissions: uniqueValues((body.permissions || []).map((permission) => sanitizeText(permission, 120))),
        expiresAt: normalizeExpiresAt(body.expiresAt || body.expires_at),
        unlimitedShopPurchases: normalizeBoolean(body.unlimitedShopPurchases ?? body.unlimited_shop_purchases)
    };

    const result = await applyAdminPermissionState(supabase, user, userId, formState, {
        actionType: 'update_admin_permissions',
        auditExtras: body.auditExtras && typeof body.auditExtras === 'object' && !Array.isArray(body.auditExtras)
            ? body.auditExtras
            : {},
        site
    });

    return {
        userId,
        roleInfo: result.currentRoleInfo,
        hasChanges: result.permissionAudit.hasChanges
    };
}

async function handleBatchRenewAdmin({ supabase, user, body, site }) {
    const userIds = requireUserIds(body);
    const renewDays = Number.parseInt(body.renewDays || body.renew_days, 10);
    if (!Number.isFinite(renewDays) || renewDays <= 0) {
        const error = new Error('renewDays must be a positive integer');
        error.statusCode = 400;
        throw error;
    }

    const [profileMap, roleRows, currentRoleInfoMap] = await Promise.all([
        fetchUserProfilesByIds(supabase, userIds),
        fetchAdminRoleRowsByUserIds(supabase, userIds),
        fetchCurrentRoleInfoMap(supabase, userIds)
    ]);
    assertNoLockedTargets(profileMap, userIds);

    const nowMs = Date.now();
    const updated = [];
    const skipped = [];

    for (const userId of userIds) {
        const roleRow = roleRows.get(userId) || null;
        if (!roleRow?.expires_at) {
            skipped.push({ userId, reason: 'missing_expiry' });
            continue;
        }

        const currentExpiresAtMs = new Date(roleRow.expires_at).getTime();
        const baseMs = Number.isFinite(currentExpiresAtMs) && currentExpiresAtMs > nowMs ? currentExpiresAtMs : nowMs;
        const nextExpiresAt = new Date(baseMs + renewDays * 24 * 60 * 60 * 1000).toISOString();

        await applyAdminPermissionState(supabase, user, userId, {
            isAdmin: true,
            permissions: Array.isArray(roleRow.permissions) ? roleRow.permissions : [],
            expiresAt: nextExpiresAt,
            unlimitedShopPurchases: currentRoleInfoMap.get(userId)?.unlimited_shop_purchases === true
        }, {
            actionType: 'update_admin_permissions',
            auditExtras: {
                save_reason: 'batch-renew',
                batch_extend_days: renewDays
            },
            site
        });

        updated.push({
            userId,
            expires_at: nextExpiresAt
        });
    }

    return {
        updated,
        skipped
    };
}

async function handleBatchSetAdminExpiry({ supabase, user, body, site }) {
    const userIds = requireUserIds(body);
    const mode = sanitizeText(body.mode, 24).toLowerCase();
    const isPermanent = mode === 'permanent' || body.expiresAt === null || body.expires_at === null;
    const nextExpiresAt = isPermanent ? null : normalizeExpiresAt(body.expiresAt || body.expires_at);

    const [profileMap, roleRows, currentRoleInfoMap] = await Promise.all([
        fetchUserProfilesByIds(supabase, userIds),
        fetchAdminRoleRowsByUserIds(supabase, userIds),
        fetchCurrentRoleInfoMap(supabase, userIds)
    ]);
    assertNoLockedTargets(profileMap, userIds);

    const updated = [];
    const skipped = [];

    for (const userId of userIds) {
        const roleRow = roleRows.get(userId) || null;
        if (!roleRow) {
            skipped.push({ userId, reason: 'missing_role' });
            continue;
        }

        await applyAdminPermissionState(supabase, user, userId, {
            isAdmin: true,
            permissions: Array.isArray(roleRow.permissions) ? roleRow.permissions : [],
            expiresAt: nextExpiresAt,
            unlimitedShopPurchases: currentRoleInfoMap.get(userId)?.unlimited_shop_purchases === true
        }, {
            actionType: 'update_admin_permissions',
            auditExtras: {
                save_reason: 'batch-set-expiry',
                batch_expiry_mode: isPermanent ? 'permanent' : 'absolute',
                batch_expiry_label: isPermanent ? '长期有效' : nextExpiresAt
            },
            site
        });

        updated.push({
            userId,
            expires_at: nextExpiresAt
        });
    }

    return {
        updated,
        skipped
    };
}

async function mutatePointsForUser(supabase, {
    userId,
    amount,
    reason,
    adminIdentity,
    site,
    index = 0
} = {}) {
    const auditReason = sanitizeText(reason, 500);
    const ledgerReason = `admin_manual: [${sanitizeText(adminIdentity, 255) || 'admin'}] ${auditReason}`;
    const referenceId = createReferenceId('admin_points', userId, index);

    let rpcResult;
    if (amount > 0) {
        const { data, error } = await supabase.rpc('fn_add_points', {
            target_user_id: userId,
            p_amount: amount,
            p_reason: ledgerReason,
            p_reference_id: referenceId,
            p_site: site
        });

        if (error) {
            throw error;
        }
        rpcResult = data || {};
    } else {
        const { data, error } = await deductPointsForService({
            supabase,
            userId,
            amount: Math.abs(amount),
            reason: ledgerReason,
            referenceId,
            site
        });

        if (error) {
            throw error;
        }
        rpcResult = data || {};
    }

    return {
        userId,
        amount,
        site,
        reason: auditReason,
        new_total: Number(rpcResult?.new_total || 0),
        deducted: Number(rpcResult?.deducted || 0),
        added: Number(rpcResult?.added || 0),
        duplicate: rpcResult?.duplicate === true
    };
}

async function handleAdjustPoints({ supabase, user, body, site }) {
    const pointsSite = requireWritableAdminSite(body.site || site || 'all');
    const userIds = requireUserIds(body);
    const amount = requireNonZeroInt(body.amount, 'amount');
    const reason = sanitizeText(body.reason, 500);
    if (!reason) {
        const error = new Error('reason is required');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(supabase, userIds);
    assertNoLockedTargets(profileMap, userIds);

    const adminIdentity = sanitizeText(user.email || user.id, 255) || 'admin';
    const results = [];

    for (let index = 0; index < userIds.length; index += 1) {
        const userId = userIds[index];
        const result = await mutatePointsForUser(supabase, {
            userId,
            amount,
            reason,
            adminIdentity,
            site: pointsSite,
            index
        });

        await notifyUsers(supabase, {
            userIds: [userId],
            title: '积分变动通知',
            content: `您的积分已${amount > 0 ? '增加' : '扣除'} ${Math.abs(amount)}。\n原因：${reason}`,
            type: amount > 0 ? 'success' : 'warning',
            scope: 'user_personal',
            category: 'admin_notice',
            dedupeWindowMinutes: 0
        });

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: userId,
            module: 'users',
            site: pointsSite,
            actionType: 'UPDATE_POINT',
            details: {
                amount,
                reason,
                site: pointsSite,
                new_total: result.new_total
            }
        });

        results.push(result);
    }

    return {
        site: pointsSite,
        results
    };
}

async function handleResetAvatar({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const profileMap = await fetchUserProfilesByIds(supabase, [userId]);
    assertNoLockedTargets(profileMap, [userId]);

    const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', userId);

    if (error) {
        throw error;
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: userId,
        module: 'users',
        site,
        actionType: 'RESET_AVATAR',
        details: {}
    });

    return {
        userId
    };
}

function normalizeClearContentSelection(body = {}) {
    return {
        comments: normalizeBoolean(body.comments),
        guestbook: normalizeBoolean(body.guestbook),
        points: normalizeBoolean(body.points),
        blocks: normalizeBoolean(body.blocks),
        notes: normalizeBoolean(body.notes),
        audit: normalizeBoolean(body.audit),
        resetPoints: normalizeBoolean(body.resetPoints || body.reset_points),
        purchases: normalizeBoolean(body.purchases)
    };
}

async function clearUserRemainingPoints(supabase, userId) {
    const { error: legacyError } = await supabase
        .from('user_points')
        .update({
            balance: 0,
            total_earned: 0
        })
        .eq('user_id', userId);

    if (legacyError) {
        throw legacyError;
    }

    // points_balance.total_balance is a generated column. Only writable
    // component balances should be reset here.
    const { error: balanceError } = await supabase
        .from('points_balance')
        .update({
            paid_balance: 0,
            bonus_balance: 0
        })
        .eq('user_id', userId);

    if (balanceError) {
        throw balanceError;
    }
}

async function clearUserPurchases(supabase, userId) {
    const { error } = await supabase
        .from('prompt_unlocks')
        .delete()
        .eq('user_id', userId);

    if (error) {
        throw error;
    }
}

async function handleClearContent({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const selections = normalizeClearContentSelection(body);
    const selectedCount = Object.values(selections).filter(Boolean).length;
    if (!selectedCount) {
        const error = new Error('At least one clear-content option must be selected');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(supabase, [userId]);
    assertNoLockedTargets(profileMap, [userId]);

    const clearedItems = [];

    if (selections.comments) {
        const { error } = await supabase
            .from('prompt_comments')
            .delete()
            .eq('user_id', userId);
        if (error) {
            throw error;
        }
        clearedItems.push('画廊评论');
    }

    if (selections.guestbook) {
        const messageDelete = await supabase
            .from('guestbook_messages')
            .delete()
            .eq('user_id', userId);
        if (messageDelete.error) {
            throw messageDelete.error;
        }

        const commentDelete = await supabase
            .from('guestbook_comments')
            .delete()
            .eq('user_id', userId);
        if (commentDelete.error) {
            throw commentDelete.error;
        }

        clearedItems.push('留言板留言');
    }

    if (selections.points) {
        const { error } = await supabase
            .from('points_ledger')
            .delete()
            .eq('user_id', userId);
        if (error) {
            throw error;
        }
        clearedItems.push('积分记录');
    }

    if (selections.blocks) {
        const { error } = await supabase
            .from('block_history')
            .delete()
            .eq('user_id', userId);
        if (error) {
            throw error;
        }
        clearedItems.push('封禁记录');
    }

    if (selections.notes) {
        const { error } = await supabase
            .from('admin_notes')
            .delete()
            .eq('target_user_id', userId);
        if (error) {
            throw error;
        }
        clearedItems.push('内部备注');
    }

    if (selections.audit) {
        const { error } = await supabase
            .from('admin_audit_logs')
            .delete()
            .eq('target_user_id', userId);
        if (error) {
            throw error;
        }
        clearedItems.push('审计日志');
    }

    if (selections.resetPoints) {
        await clearUserRemainingPoints(supabase, userId);
        clearedItems.push('剩余积分(重置为0)');
    }

    if (selections.purchases) {
        await clearUserPurchases(supabase, userId);
        clearedItems.push('购买记录(已收回)');
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: userId,
        module: 'users',
        site,
        actionType: 'CLEAR_CONTENT',
        details: {
            cleared_items: clearedItems
        }
    });

    return {
        userId,
        clearedItems
    };
}

async function handleAddTag({ supabase, user, body, site }) {
    const userIds = requireUserIds(body);
    const tag = normalizeTagValue(body.tag);
    if (!tag) {
        const error = new Error('tag is required');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(supabase, userIds);
    assertNoLockedTargets(profileMap, userIds);

    const payload = userIds.map((userId) => ({
        user_id: userId,
        tag,
        created_by: user.id
    }));
    const { error } = await supabase
        .from('user_tags')
        .upsert(payload, {
            onConflict: 'user_id,tag'
        });

    if (error) {
        throw error;
    }

    for (const userId of userIds) {
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: userId,
            module: 'users',
            site,
            actionType: 'add_tag',
            details: { tag }
        });
    }

    return {
        userIds,
        tag
    };
}

async function handleRemoveTag({ supabase, user, body, site }) {
    const userIds = requireUserIds(body);
    const tag = normalizeTagValue(body.tag);
    if (!tag) {
        const error = new Error('tag is required');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(supabase, userIds);
    assertNoLockedTargets(profileMap, userIds);

    const { error } = await supabase
        .from('user_tags')
        .delete()
        .in('user_id', userIds)
        .eq('tag', tag);

    if (error) {
        throw error;
    }

    for (const userId of userIds) {
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: userId,
            module: 'users',
            site,
            actionType: 'remove_tag',
            details: { tag }
        });
    }

    return {
        userIds,
        tag
    };
}

async function handleAddNote({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const content = sanitizeText(body.content, 4000);
    if (!content) {
        const error = new Error('content is required');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(supabase, [userId]);
    assertNoLockedTargets(profileMap, [userId]);

    const { error } = await supabase
        .from('admin_notes')
        .insert({
            target_user_id: userId,
            admin_id: user.id,
            content
        });

    if (error) {
        throw error;
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: userId,
        module: 'users',
        site,
        actionType: 'ADD_NOTE',
        details: {
            content_preview: content.slice(0, 20)
        }
    });

    return {
        userId,
        content_preview: content.slice(0, 20)
    };
}

async function handleSendNotification({ supabase, user, body, site }) {
    const userIds = requireUserIds(body);
    const title = sanitizeText(body.title, 160);
    const content = sanitizeText(body.content, 4000);
    const type = normalizeNotificationType(body.type, 'info');

    if (!title || !content) {
        const error = new Error('title and content are required');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(supabase, userIds);
    assertNoLockedTargets(profileMap, userIds);

    const result = await notifyUsers(supabase, {
        userIds,
        title,
        content,
        type,
        scope: 'user_personal',
        category: 'admin_notice',
        dedupeWindowMinutes: 0
    });

    for (const userId of userIds) {
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: userId,
            module: 'users',
            site,
            actionType: 'SEND_NOTIFICATION',
            details: {
                title,
                type
            }
        });
    }

    return result;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'users.manage' });
        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action, 80).toLowerCase();
        const site = normalizeAdminSite(body.site || req.adminSite, { defaultValue: 'all' }) || 'all';

        let payload;
        switch (action) {
        case 'grant_admin':
            payload = await handleGrantAdmin({ supabase, user, body, site });
            break;
        case 'revoke_admin':
            payload = await handleRevokeAdmin({ supabase, user, body, site });
            break;
        case 'update_admin_permissions':
            payload = await handleUpdateAdminPermissions({ supabase, user, body, site });
            break;
        case 'batch_renew_admin':
            payload = await handleBatchRenewAdmin({ supabase, user, body, site });
            break;
        case 'batch_set_admin_expiry':
            payload = await handleBatchSetAdminExpiry({ supabase, user, body, site });
            break;
        case 'adjust_points':
            payload = await handleAdjustPoints({ supabase, user, body, site });
            break;
        case 'reset_avatar':
            payload = await handleResetAvatar({ supabase, user, body, site });
            break;
        case 'clear_content':
            payload = await handleClearContent({ supabase, user, body, site });
            break;
        case 'add_tag':
            payload = await handleAddTag({ supabase, user, body, site });
            break;
        case 'remove_tag':
            payload = await handleRemoveTag({ supabase, user, body, site });
            break;
        case 'add_note':
            payload = await handleAddNote({ supabase, user, body, site });
            break;
        case 'send_notification':
            payload = await handleSendNotification({ supabase, user, body, site });
            break;
        default: {
            const error = new Error('Unsupported users manage action');
            error.statusCode = 400;
            throw error;
        }
        }

        return sendJson(res, 200, {
            success: true,
            action,
            ...payload
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Users manage request failed'
        });
    }
};
