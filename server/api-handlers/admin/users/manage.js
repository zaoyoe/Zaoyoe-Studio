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

function normalizeEmail(value = '') {
    const normalized = sanitizeText(value, 320).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function normalizeEmailArray(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
    return uniqueValues(source.map(normalizeEmail).filter(Boolean));
}

function normalizePointsAdjustmentKind(reason = '', amount = 0) {
    const normalizedReason = sanitizeText(reason, 500).toLowerCase();
    const correctionHints = ['修正', '纠正', '校正', '更正', 'fix', 'correct', 'adjust', 'reconcile', 'manual'];
    const creditHints = ['补发', '补偿', '返还', '奖励', '赠送', '退款返积分', 'bonus', 'reward', 'grant', 'compensat', 'refund'];
    const debitHints = ['扣除', '扣减', '撤销', '罚', '惩罚', '消费', '回收', 'deduct', 'revoke', 'penalty', 'consume'];

    if (correctionHints.some((hint) => normalizedReason.includes(hint))) {
        return 'correction';
    }
    if (amount > 0 || creditHints.some((hint) => normalizedReason.includes(hint))) {
        return 'credit';
    }
    if (amount < 0 || debitHints.some((hint) => normalizedReason.includes(hint))) {
        return 'debit';
    }
    return 'adjustment';
}

function buildPointsAdjustedNotificationCopy(amount = 0, reason = '', newTotal = 0) {
    const normalizedAmount = Number(amount || 0) || 0;
    const absoluteAmount = Math.abs(normalizedAmount);
    const reasonText = sanitizeText(reason, 500);
    const adjustmentKind = normalizePointsAdjustmentKind(reasonText, normalizedAmount);
    const adjustmentDirection = normalizedAmount > 0 ? 'increase' : (normalizedAmount < 0 ? 'decrease' : 'neutral');
    let title = '积分有更新';
    let type = 'info';
    let priority = 28;
    let summary = absoluteAmount > 0 ? `本次变动：${absoluteAmount} 积分。` : '本次积分记录已更新。';

    if (adjustmentKind === 'correction') {
        title = '积分记录已修正';
        type = normalizedAmount < 0 ? 'warning' : 'info';
        priority = normalizedAmount < 0 ? 33 : 28;
        summary = absoluteAmount > 0
            ? `客服刚刚修正了你的积分记录，本次调整 ${absoluteAmount} 积分。`
            : '客服刚刚修正了你的积分记录。';
    } else if (adjustmentDirection === 'increase') {
        title = '积分已补发';
        type = 'success';
        priority = 24;
        summary = `客服刚刚为你补发了 ${absoluteAmount} 积分。`;
    } else if (adjustmentDirection === 'decrease') {
        title = '积分已扣减';
        type = 'warning';
        priority = 35;
        summary = `客服刚刚为你扣减了 ${absoluteAmount} 积分。`;
    }

    const lines = [summary];
    if (reasonText) {
        lines.push(`原因：${reasonText}`);
    }
    if (Number.isFinite(Number(newTotal))) {
        lines.push(`当前可用积分：${Number(newTotal)}`);
    }

    return {
        title,
        content: lines.join('\n'),
        type,
        priority,
        adjustmentKind,
        adjustmentDirection
    };
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

function requireAssetId(body = {}) {
    const assetId = sanitizeText(body.assetId || body.asset_id, 160);
    if (!assetId) {
        const error = new Error('assetId is required');
        error.statusCode = 400;
        throw error;
    }
    return assetId;
}

function normalizeDiscountAssetStatus(value) {
    return sanitizeText(value, 40).toLowerCase() || 'available';
}

function normalizeDiscountApplicableSite(value) {
    const normalized = sanitizeText(value, 20).toLowerCase();
    if (!normalized || normalized === 'all' || normalized === 'global') {
        return '';
    }
    return normalized;
}

function buildPermissionChangeNotification({ action = 'update', permissions = [], expiresAt = null } = {}) {
    const normalizedAction = sanitizeText(action, 40).toLowerCase();
    const permissionCount = Array.isArray(permissions) ? permissions.length : 0;
    const expiryLine = expiresAt
        ? `有效期至：${expiresAt}`
        : '有效期：长期有效';

    if (normalizedAction === 'grant') {
        return {
            title: '账号权限已开通',
            content: `管理员已为你的账号开通新的访问权限。\n权限数量：${permissionCount}\n${expiryLine}`,
            type: 'success'
        };
    }

    if (normalizedAction === 'revoke') {
        return {
            title: '账号权限已调整',
            content: '管理员已收回你的后台访问权限；如需继续使用，请联系站长确认。',
            type: 'warning'
        };
    }

    return {
        title: '账号权限已更新',
        content: `你的账号权限配置发生变化。\n权限数量：${permissionCount}\n${expiryLine}`,
        type: 'info'
    };
}

async function notifyPermissionChange(supabase, {
    userId,
    action = 'update',
    permissions = [],
    expiresAt = null,
    site = 'all'
} = {}) {
    const notification = buildPermissionChangeNotification({ action, permissions, expiresAt });
    return notifyUsers(supabase, {
        userIds: [userId],
        ...notification,
        scope: 'user_personal',
        category: 'permission_changed',
        actionLabel: '查看账号',
        actionUrl: '/index.html',
        sourceModule: 'users',
        sourceEventId: `permission_changed:${sanitizeText(userId, 80)}:${Date.now()}`,
        priority: 40,
        metadata: {
            page_id: 'home',
            site,
            event_type: 'permission_changed',
            action,
            permissions,
            expires_at: expiresAt
        },
        dedupeWindowMinutes: 0
    });
}

function isMissingDiscountEventsRelationError(error) {
    const message = sanitizeText(error?.message, 240).toLowerCase();
    return message.includes('discount_event_logs') && (
        message.includes('does not exist')
        || message.includes('not exist')
        || message.includes('undefined table')
    );
}

function isMissingAdminAuditLogsRelationError(error) {
    const message = sanitizeText(error?.message, 240).toLowerCase();
    return message.includes('admin_audit_logs') && (
        message.includes('does not exist')
        || message.includes('not exist')
        || message.includes('undefined table')
    );
}

function formatDiscountBenefitLabel(discount = {}) {
    const discountType = sanitizeText(discount?.discount_type, 20).toLowerCase();
    const discountValue = Number(discount?.discount_value);

    if (discountType === 'percent') {
        const folded = discountValue / 10;
        if (Number.isFinite(folded) && folded > 0) {
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

    return sanitizeText(discount?.code, 80) || '优惠券';
}

function formatDiscountAssetStatusLabel(status = '') {
    const normalized = normalizeDiscountAssetStatus(status);
    if (normalized === 'used') return '已使用';
    if (normalized === 'expired') return '已失效';
    if (normalized === 'revoked') return '已撤销';
    return '可使用';
}

function assetMatchesAdminSite(asset = {}, site = 'all') {
    const normalizedSite = normalizeDiscountApplicableSite(site);
    if (!normalizedSite) {
        return true;
    }

    const applicableSite = normalizeDiscountApplicableSite(asset?.applicable_site);
    return !applicableSite || applicableSite === normalizedSite;
}

function buildDiscountAssetPayload(asset = {}, discount = {}, removalMeta = null, adminRemovalMeta = null) {
    const assetStatus = normalizeDiscountAssetStatus(asset?.asset_status);
    const expiresAt = sanitizeText(asset?.expires_at, 80) || sanitizeText(discount?.expires_at, 80) || null;
    const normalizedRemovalEventType = sanitizeText(removalMeta?.event_type, 40).toLowerCase();
    const restoredAtMs = new Date(sanitizeText(asset?.restored_at, 80) || 0).getTime() || 0;
    const walletRemovalAtMs = new Date(sanitizeText(removalMeta?.created_at, 80) || 0).getTime() || 0;
    const adminRemovalAtMs = new Date(sanitizeText(adminRemovalMeta?.created_at, 80) || 0).getTime() || 0;
    const hasWalletRemoval = normalizedRemovalEventType === 'wallet_remove'
        && walletRemovalAtMs > 0
        && walletRemovalAtMs >= restoredAtMs;
    const hasAdminRemoval = adminRemovalAtMs > 0 && adminRemovalAtMs >= restoredAtMs;
    const removalOrigin = assetStatus === 'revoked'
        ? (hasWalletRemoval ? 'user' : hasAdminRemoval ? 'admin' : 'user')
        : null;
    const removalOriginLabel = removalOrigin === 'user'
        ? '用户删除'
        : removalOrigin === 'admin'
            ? '后台删除'
            : null;

    return {
        id: sanitizeText(asset?.id, 160) || null,
        user_id: sanitizeText(asset?.user_id, 160) || null,
        discount_id: sanitizeText(asset?.discount_id, 160) || null,
        code: sanitizeText(discount?.code, 80) || null,
        benefit_label: formatDiscountBenefitLabel(discount),
        applicable_site: normalizeDiscountApplicableSite(discount?.applicable_site) || '',
        discount_type: sanitizeText(discount?.discount_type, 40).toLowerCase() || null,
        discount_value: Number.isFinite(Number(discount?.discount_value)) ? Number(discount.discount_value) : null,
        distribution_mode: sanitizeText(discount?.distribution_mode, 40).toLowerCase() || null,
        pricing_apply_stage: sanitizeText(discount?.pricing_apply_stage, 40).toLowerCase() || null,
        is_exclusive: discount?.is_exclusive === false ? false : true,
        stack_priority: Number.isFinite(Number(discount?.stack_priority)) ? Number(discount.stack_priority) : null,
        asset_status: assetStatus,
        assigned_at: sanitizeText(asset?.assigned_at, 80) || null,
        claimed_at: sanitizeText(asset?.claimed_at, 80) || null,
        consumed_at: sanitizeText(asset?.consumed_at, 80) || null,
        expires_at: expiresAt,
        restored_at: sanitizeText(asset?.restored_at, 80) || null,
        source_type: sanitizeText(asset?.source_type, 80).toLowerCase() || null,
        source_channel: sanitizeText(asset?.source_channel, 80).toLowerCase() || null,
        audience_segment: sanitizeText(asset?.audience_segment, 80).toLowerCase() || null,
        source_batch_id: sanitizeText(asset?.source_batch_id, 120) || null,
        last_order_id: sanitizeText(asset?.last_order_id, 160) || null,
        removal_origin: removalOrigin,
        removal_origin_label: removalOriginLabel,
        removal_recorded_at: sanitizeText(removalMeta?.created_at, 80)
            || sanitizeText(adminRemovalMeta?.created_at, 80)
            || (assetStatus === 'revoked' ? sanitizeText(asset?.updated_at, 80) || null : null),
        created_at: sanitizeText(asset?.created_at, 80)
            || sanitizeText(asset?.assigned_at, 80)
            || sanitizeText(asset?.claimed_at, 80)
            || sanitizeText(asset?.updated_at, 80)
            || null,
        updated_at: sanitizeText(asset?.updated_at, 80) || null,
        can_remove: assetStatus === 'available'
    };
}

async function loadDiscountRowsByIds(supabase, discountIds = []) {
    const ids = [...new Set((Array.isArray(discountIds) ? discountIds : [])
        .map((value) => sanitizeText(value, 160))
        .filter(Boolean))];
    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('discount_codes')
        .select('id, code, applicable_site, discount_type, discount_value, distribution_mode, pricing_apply_stage, is_exclusive, stack_priority, expires_at')
        .in('id', ids);

    if (error) {
        throw error;
    }

    return new Map((Array.isArray(data) ? data : []).map((row) => [sanitizeText(row?.id, 160), row]));
}

async function loadUserDiscountAssetRows(supabase, userId = '') {
    const normalizedUserId = sanitizeText(userId, 160);
    if (!normalizedUserId) {
        return [];
    }

    const { data, error } = await supabase
        .from('discount_user_assets')
        .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment, source_batch_id, last_order_id, created_at, updated_at')
        .eq('user_id', normalizedUserId)
        .order('assigned_at', { ascending: false });

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadSingleUserDiscountAsset(supabase, { userId = '', assetId = '' } = {}) {
    const normalizedUserId = sanitizeText(userId, 160);
    const normalizedAssetId = sanitizeText(assetId, 160);
    if (!normalizedUserId || !normalizedAssetId) {
        return null;
    }

    const { data, error } = await supabase
        .from('discount_user_assets')
        .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment, source_batch_id, last_order_id, created_at, updated_at')
        .eq('id', normalizedAssetId)
        .eq('user_id', normalizedUserId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data || null;
}

async function loadDiscountAssetRemovalMetaMap(supabase, assetRows = []) {
    const revokedAssetIds = [...new Set((Array.isArray(assetRows) ? assetRows : [])
        .filter((asset) => normalizeDiscountAssetStatus(asset?.asset_status) === 'revoked')
        .map((asset) => sanitizeText(asset?.id, 160))
        .filter(Boolean))];

    if (!revokedAssetIds.length) {
        return new Map();
    }

    try {
        const { data, error } = await supabase
            .from('discount_event_logs')
            .select('discount_asset_id, event_type, event_source, created_at')
            .in('discount_asset_id', revokedAssetIds);

        if (error) {
            throw error;
        }

        const rows = (Array.isArray(data) ? data : [])
            .filter((row) => sanitizeText(row?.event_type, 40).toLowerCase() === 'wallet_remove')
            .sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime());

        const result = new Map();
        rows.forEach((row) => {
            const assetId = sanitizeText(row?.discount_asset_id, 160);
            if (assetId && !result.has(assetId)) {
                result.set(assetId, row);
            }
        });
        return result;
    } catch (error) {
        if (isMissingDiscountEventsRelationError(error)) {
            return new Map();
        }
        throw error;
    }
}

async function loadAdminDiscountAssetRemovalMap(supabase, assetRows = []) {
    const revokedAssets = (Array.isArray(assetRows) ? assetRows : [])
        .filter((asset) => normalizeDiscountAssetStatus(asset?.asset_status) === 'revoked');
    const targetUserIds = [...new Set(revokedAssets.map((asset) => sanitizeText(asset?.user_id, 160)).filter(Boolean))];

    if (!targetUserIds.length) {
        return new Map();
    }

    try {
        const { data, error } = await supabase
            .from('admin_audit_logs')
            .select('target_user_id, action_type, details, created_at')
            .in('target_user_id', targetUserIds)
            .eq('action_type', 'remove_user_discount_asset');

        if (error) {
            throw error;
        }

        const rows = (Array.isArray(data) ? data : [])
            .slice()
            .sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime());
        const result = new Map();

        rows.forEach((row) => {
            const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
                ? row.details
                : {};
            const assetId = sanitizeText(details?.asset_id, 160);
            if (assetId && !result.has(assetId)) {
                result.set(assetId, row);
            }
        });

        return result;
    } catch (error) {
        if (isMissingAdminAuditLogsRelationError(error)) {
            return new Map();
        }
        throw error;
    }
}

async function resolveDiscountAssetPayloads(supabase, assetRows = []) {
    const [discountMap, removalMetaMap, adminRemovalMetaMap] = await Promise.all([
        loadDiscountRowsByIds(supabase, assetRows.map((row) => row?.discount_id)),
        loadDiscountAssetRemovalMetaMap(supabase, assetRows),
        loadAdminDiscountAssetRemovalMap(supabase, assetRows)
    ]);
    return (Array.isArray(assetRows) ? assetRows : []).map((asset) => (
        buildDiscountAssetPayload(
            asset,
            discountMap.get(sanitizeText(asset?.discount_id, 160)) || {},
            removalMetaMap.get(sanitizeText(asset?.id, 160)) || null,
            adminRemovalMetaMap.get(sanitizeText(asset?.id, 160)) || null
        )
    ));
}

function sortDiscountAssetPayloads(rows = []) {
    const statusRank = new Map([
        ['available', 0],
        ['used', 1],
        ['expired', 2],
        ['revoked', 3]
    ]);

    return [...rows].sort((left, right) => {
        const leftRank = statusRank.get(normalizeDiscountAssetStatus(left?.asset_status)) ?? 9;
        const rightRank = statusRank.get(normalizeDiscountAssetStatus(right?.asset_status)) ?? 9;
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        const rightTime = new Date(right?.assigned_at || right?.created_at || 0).getTime();
        const leftTime = new Date(left?.assigned_at || left?.created_at || 0).getTime();
        return rightTime - leftTime;
    });
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

    await notifyPermissionChange(supabase, {
        userId,
        action: 'grant',
        permissions,
        expiresAt,
        site
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

    await notifyPermissionChange(supabase, {
        userId,
        action: 'revoke',
        permissions: [],
        expiresAt: null,
        site
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

    if (result.permissionAudit.hasChanges) {
        await notifyPermissionChange(supabase, {
            userId,
            action: formState.isAdmin ? 'update' : 'revoke',
            permissions: formState.isAdmin ? formState.permissions : [],
            expiresAt: formState.isAdmin ? formState.expiresAt : null,
            site
        });
    }

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
        reference_id: referenceId,
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
        const notificationCopy = buildPointsAdjustedNotificationCopy(amount, reason, result.new_total);

        await notifyUsers(supabase, {
            userIds: [userId],
            title: notificationCopy.title,
            content: notificationCopy.content,
            type: notificationCopy.type,
            scope: 'user_personal',
            category: 'points_adjusted',
            actionLabel: '查看积分',
            actionUrl: 'wallet://balance',
            sourceModule: 'points',
            sourceEventId: result.reference_id,
            priority: notificationCopy.priority,
            metadata: {
                page_id: 'home',
                site: pointsSite,
                event_type: 'points_adjusted',
                amount,
                reason,
                new_total: result.new_total,
                adjustment_kind: notificationCopy.adjustmentKind,
                adjustment_direction: notificationCopy.adjustmentDirection,
                action_path_label: '我的钱包 > 积分',
                action_path_url: 'wallet://balance',
                wallet_view: 'balance'
            },
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

function normalizeEmailTagImportEntries(body = {}) {
    const defaultTag = normalizeTagValue(body.tag || body.defaultTag || body.default_tag);
    const entries = [];

    if (Array.isArray(body.entries)) {
        body.entries.forEach((entry) => {
            const email = normalizeEmail(entry?.email || entry?.user_email || entry?.userEmail);
            const tag = normalizeTagValue(entry?.tag || defaultTag);
            if (email && tag) {
                entries.push({ email, tag });
            }
        });
    }

    normalizeEmailArray(body.emails || body.email_list || body.emailList).forEach((email) => {
        if (defaultTag) {
            entries.push({ email, tag: defaultTag });
        }
    });

    String(body.importText || body.import_text || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
            const [emailPart, tagPart] = line.split(/[\t,， ]+/);
            const email = normalizeEmail(emailPart);
            const tag = normalizeTagValue(tagPart || defaultTag);
            if (email && tag) {
                entries.push({ email, tag });
            }
        });

    return Array.from(new Map(entries.map((entry) => [`${entry.email}:${entry.tag}`, entry])).values());
}

async function handleImportTagsByEmail({ supabase, user, body, site }) {
    const entries = normalizeEmailTagImportEntries(body);
    if (!entries.length) {
        const error = new Error('At least one email and tag entry is required');
        error.statusCode = 400;
        throw error;
    }

    const emails = uniqueValues(entries.map((entry) => entry.email));
    const { data, error } = await supabase
        .from('profiles')
        .select('id, email, username')
        .in('email', emails);
    if (error) throw error;

    const profileByEmail = new Map((Array.isArray(data) ? data : [])
        .filter((row) => row?.id && row?.email)
        .map((row) => [normalizeEmail(row.email), row]));
    const matchedEntries = entries
        .map((entry) => ({
            ...entry,
            profile: profileByEmail.get(entry.email) || null
        }))
        .filter((entry) => entry.profile?.id);
    const userIds = uniqueValues(matchedEntries.map((entry) => sanitizeText(entry.profile.id, 160)));

    const profileMap = new Map((Array.isArray(data) ? data : [])
        .filter((row) => row?.id)
        .map((row) => [sanitizeText(row.id, 160), row]));
    assertNoLockedTargets(profileMap, userIds);

    const payload = matchedEntries.map((entry) => ({
        user_id: sanitizeText(entry.profile.id, 160),
        tag: entry.tag,
        created_by: user.id
    }));
    if (payload.length) {
        const { error: upsertError } = await supabase
            .from('user_tags')
            .upsert(payload, {
                onConflict: 'user_id,tag'
            });
        if (upsertError) throw upsertError;
    }

    for (const entry of matchedEntries) {
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: sanitizeText(entry.profile.id, 160),
            module: 'users',
            site,
            actionType: 'import_tag_by_email',
            details: {
                email: entry.email,
                tag: entry.tag
            }
        });
    }

    const matchedEmails = new Set(matchedEntries.map((entry) => entry.email));
    return {
        matched: matchedEntries.length,
        missing: emails.filter((email) => !matchedEmails.has(email)),
        tags: uniqueValues(matchedEntries.map((entry) => entry.tag))
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
        actionLabel: sanitizeText(body.actionLabel || body.action_label, 80),
        actionUrl: sanitizeText(body.actionUrl || body.action_url, 1000),
        sourceModule: 'users',
        sourceEventId: `admin_notice:${Date.now()}`,
        priority: 20,
        metadata: {
            page_id: 'home',
            site,
            event_type: 'admin_notice'
        },
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

async function handleListDiscountAssets({ supabase, body, site }) {
    const userId = requireSingleUserId(body);
    const assetRows = await loadUserDiscountAssetRows(supabase, userId);
    const assets = sortDiscountAssetPayloads(
        (await resolveDiscountAssetPayloads(supabase, assetRows))
            .filter((asset) => assetMatchesAdminSite(asset, site))
    );

    return {
        userId,
        assets
    };
}

async function handleRevokeDiscountAsset({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const assetId = requireAssetId(body);

    const assetRow = await loadSingleUserDiscountAsset(supabase, { userId, assetId });
    if (!assetRow) {
        const error = new Error('未找到该用户优惠券');
        error.statusCode = 404;
        throw error;
    }

    const [asset] = await resolveDiscountAssetPayloads(supabase, [assetRow]);
    if (!asset) {
        const error = new Error('未找到该用户优惠券');
        error.statusCode = 404;
        throw error;
    }

    if (!assetMatchesAdminSite(asset, site)) {
        const error = new Error('当前站点下不可删除这张优惠券');
        error.statusCode = 409;
        throw error;
    }

    const previousStatus = normalizeDiscountAssetStatus(asset.asset_status);
    if (previousStatus === 'revoked') {
        const error = new Error('这张优惠券已删除');
        error.statusCode = 409;
        throw error;
    }
    if (previousStatus !== 'available') {
        const error = new Error(`${formatDiscountAssetStatusLabel(previousStatus)}优惠券不支持删除`);
        error.statusCode = 409;
        throw error;
    }

    const updatedAt = new Date().toISOString();
    const { error } = await supabase
        .from('discount_user_assets')
        .update({
            asset_status: 'revoked',
            updated_at: updatedAt
        })
        .eq('id', assetId)
        .eq('user_id', userId);

    if (error) {
        throw error;
    }

    const updatedAsset = {
        ...asset,
        asset_status: 'revoked',
        updated_at: updatedAt,
        can_remove: false,
        removal_origin: 'admin',
        removal_origin_label: '后台删除',
        removal_recorded_at: updatedAt
    };

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: userId,
        module: 'users',
        site,
        actionType: 'remove_user_discount_asset',
        details: {
            asset_id: updatedAsset.id,
            discount_id: updatedAsset.discount_id,
            code: updatedAsset.code,
            benefit_label: updatedAsset.benefit_label,
            applicable_site: updatedAsset.applicable_site || 'global',
            asset_status_before: previousStatus,
            asset_status_after: 'revoked',
            assigned_at: updatedAsset.assigned_at,
            claimed_at: updatedAsset.claimed_at,
            expires_at: updatedAsset.expires_at,
            source_type: updatedAsset.source_type,
            source_channel: updatedAsset.source_channel,
            audience_segment: updatedAsset.audience_segment,
            source_batch_id: updatedAsset.source_batch_id,
            last_order_id: updatedAsset.last_order_id
        }
    });

    return {
        userId,
        asset: updatedAsset
    };
}

async function handleRestoreDiscountAsset({ supabase, user, body, site }) {
    const userId = requireSingleUserId(body);
    const assetId = requireAssetId(body);

    const assetRow = await loadSingleUserDiscountAsset(supabase, { userId, assetId });
    if (!assetRow) {
        const error = new Error('未找到该用户优惠券');
        error.statusCode = 404;
        throw error;
    }

    const [asset] = await resolveDiscountAssetPayloads(supabase, [assetRow]);
    if (!asset) {
        const error = new Error('未找到该用户优惠券');
        error.statusCode = 404;
        throw error;
    }

    if (!assetMatchesAdminSite(asset, site)) {
        const error = new Error('当前站点下不可恢复这张优惠券');
        error.statusCode = 409;
        throw error;
    }

    const previousStatus = normalizeDiscountAssetStatus(asset.asset_status);
    if (previousStatus === 'available') {
        const error = new Error('这张优惠券当前已可使用');
        error.statusCode = 409;
        throw error;
    }
    if (previousStatus !== 'revoked') {
        const error = new Error(`${formatDiscountAssetStatusLabel(previousStatus)}优惠券不支持恢复`);
        error.statusCode = 409;
        throw error;
    }

    const restoredAt = new Date().toISOString();
    const { error } = await supabase
        .from('discount_user_assets')
        .update({
            asset_status: 'available',
            restored_at: restoredAt,
            updated_at: restoredAt
        })
        .eq('id', assetId)
        .eq('user_id', userId);

    if (error) {
        throw error;
    }

    const restoredAsset = {
        ...asset,
        asset_status: 'available',
        restored_at: restoredAt,
        updated_at: restoredAt,
        can_remove: true,
        removal_origin: null,
        removal_origin_label: null,
        removal_recorded_at: null
    };

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: userId,
        module: 'users',
        site,
        actionType: 'restore_user_discount_asset',
        details: {
            asset_id: restoredAsset.id,
            discount_id: restoredAsset.discount_id,
            code: restoredAsset.code,
            benefit_label: restoredAsset.benefit_label,
            applicable_site: restoredAsset.applicable_site || 'global',
            asset_status_before: previousStatus,
            asset_status_after: 'available',
            assigned_at: restoredAsset.assigned_at,
            claimed_at: restoredAsset.claimed_at,
            expires_at: restoredAsset.expires_at,
            restored_at: restoredAt,
            source_type: restoredAsset.source_type,
            source_channel: restoredAsset.source_channel,
            audience_segment: restoredAsset.audience_segment,
            source_batch_id: restoredAsset.source_batch_id,
            last_order_id: restoredAsset.last_order_id
        }
    });

    return {
        userId,
        asset: restoredAsset
    };
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
        case 'import_tags_by_email':
            payload = await handleImportTagsByEmail({ supabase, user, body, site });
            break;
        case 'add_note':
            payload = await handleAddNote({ supabase, user, body, site });
            break;
        case 'send_notification':
            payload = await handleSendNotification({ supabase, user, body, site });
            break;
        case 'list_discount_assets':
            payload = await handleListDiscountAssets({ supabase, user, body, site });
            break;
        case 'revoke_discount_asset':
            payload = await handleRevokeDiscountAsset({ supabase, user, body, site });
            break;
        case 'restore_discount_asset':
            payload = await handleRestoreDiscountAsset({ supabase, user, body, site });
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
