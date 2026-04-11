const { normalizeAdminPermissionList } = require('../../../../api/_lib/admin');

const LOCKED_SUPER_ADMIN_EMAILS = new Set([
    'fjivvid@163.com',
    'zaoyoe@gmail.com'
]);

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function uniqueValues(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function normalizeUserIds(value, fallback = null) {
    const values = Array.isArray(value)
        ? value
        : (fallback == null ? [] : [fallback]);

    return uniqueValues(values.map((entry) => sanitizeText(entry, 160)));
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = sanitizeText(value, 24).toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeNotificationType(value, fallback = 'info') {
    const normalized = sanitizeText(value, 24).toLowerCase();
    return ['info', 'warning', 'success', 'alert'].includes(normalized)
        ? normalized
        : fallback;
}

function normalizeTagValue(value) {
    return sanitizeText(value, 120);
}

function isLockedSuperAdminEmail(email = '') {
    return LOCKED_SUPER_ADMIN_EMAILS.has(sanitizeText(email, 320).toLowerCase());
}

function getNormalizedAdminPermissionAuditState(roleInfo = {}) {
    const rawExpiresAt = roleInfo?.expires_at ? new Date(roleInfo.expires_at) : null;
    return {
        isAdmin: roleInfo?.is_admin === true,
        permissions: normalizeAdminPermissionList(roleInfo?.permissions || []),
        expiresAt: rawExpiresAt && Number.isFinite(rawExpiresAt.getTime()) ? rawExpiresAt.toISOString() : null,
        unlimitedShopPurchases: roleInfo?.unlimited_shop_purchases === true
    };
}

function buildAdminPermissionChangeDetails(previousRoleInfo = {}, nextFormState = {}, extras = {}) {
    const previousState = getNormalizedAdminPermissionAuditState(previousRoleInfo);
    const nextState = {
        isAdmin: nextFormState?.isAdmin === true,
        permissions: nextFormState?.isAdmin ? normalizeAdminPermissionList(nextFormState.permissions || []) : [],
        expiresAt: nextFormState?.isAdmin ? (nextFormState.expiresAt || null) : null,
        unlimitedShopPurchases: nextFormState?.unlimitedShopPurchases === true
    };
    const permissionsAdded = nextState.permissions.filter((permissionKey) => !previousState.permissions.includes(permissionKey));
    const permissionsRemoved = previousState.permissions.filter((permissionKey) => !nextState.permissions.includes(permissionKey));
    const hasChanges =
        previousState.isAdmin !== nextState.isAdmin ||
        previousState.expiresAt !== nextState.expiresAt ||
        previousState.unlimitedShopPurchases !== nextState.unlimitedShopPurchases ||
        permissionsAdded.length > 0 ||
        permissionsRemoved.length > 0;

    return {
        hasChanges,
        details: {
            permissions: nextState.permissions,
            permissions_before: previousState.permissions,
            permissions_after: nextState.permissions,
            permissions_added: permissionsAdded,
            permissions_removed: permissionsRemoved,
            is_admin_before: previousState.isAdmin,
            is_admin_after: nextState.isAdmin,
            expires_at_before: previousState.expiresAt,
            expires_at_after: nextState.expiresAt,
            unlimited_shop_purchases_before: previousState.unlimitedShopPurchases,
            unlimited_shop_purchases_after: nextState.unlimitedShopPurchases,
            ...extras
        }
    };
}

function shapeUserRoleInfo(roleRow = null, entitlementRow = null) {
    return {
        is_admin: Boolean(roleRow),
        role_name: sanitizeText(roleRow?.role_name || 'admin', 80) || 'admin',
        permissions: normalizeAdminPermissionList(roleRow?.permissions || []),
        expires_at: roleRow?.expires_at || null,
        unlimited_shop_purchases: entitlementRow?.unlimited_shop_purchases === true
    };
}

async function fetchUserProfilesByIds(supabase, userIds = []) {
    const normalizedUserIds = normalizeUserIds(userIds);
    if (!normalizedUserIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('id, email, username')
        .in('id', normalizedUserIds);

    if (error) {
        throw error;
    }

    return new Map(
        (data || [])
            .filter((row) => row?.id)
            .map((row) => [sanitizeText(row.id, 160), row])
    );
}

async function fetchAdminRoleRowsByUserIds(supabase, userIds = []) {
    const normalizedUserIds = normalizeUserIds(userIds);
    if (!normalizedUserIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('admin_roles')
        .select('user_id, role_name, permissions, expires_at')
        .in('user_id', normalizedUserIds);

    if (error) {
        throw error;
    }

    return new Map(
        (data || [])
            .filter((row) => row?.user_id)
            .map((row) => [sanitizeText(row.user_id, 160), row])
    );
}

async function fetchUserEntitlementsByUserIds(supabase, userIds = []) {
    const normalizedUserIds = normalizeUserIds(userIds);
    if (!normalizedUserIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('user_purchase_entitlements')
        .select('user_id, unlimited_shop_purchases')
        .in('user_id', normalizedUserIds);

    if (error) {
        throw error;
    }

    return new Map(
        (data || [])
            .filter((row) => row?.user_id)
            .map((row) => [sanitizeText(row.user_id, 160), row])
    );
}

async function fetchCurrentRoleInfoMap(supabase, userIds = []) {
    const normalizedUserIds = normalizeUserIds(userIds);
    if (!normalizedUserIds.length) {
        return new Map();
    }

    const [roleRows, entitlementRows] = await Promise.all([
        fetchAdminRoleRowsByUserIds(supabase, normalizedUserIds),
        fetchUserEntitlementsByUserIds(supabase, normalizedUserIds)
    ]);

    return normalizedUserIds.reduce((accumulator, userId) => {
        accumulator.set(
            userId,
            shapeUserRoleInfo(
                roleRows.get(userId) || null,
                entitlementRows.get(userId) || null
            )
        );
        return accumulator;
    }, new Map());
}

function assertNoLockedTargets(profileMap, userIds = []) {
    const lockedTargets = normalizeUserIds(userIds).filter((userId) => {
        const profile = profileMap.get(userId) || null;
        return isLockedSuperAdminEmail(profile?.email || '');
    });

    if (!lockedTargets.length) {
        return;
    }

    const error = new Error('内置超管账号不能在用户后台中修改');
    error.statusCode = 403;
    error.code = 'locked_super_admin';
    error.userIds = lockedTargets;
    throw error;
}

module.exports = {
    LOCKED_SUPER_ADMIN_EMAILS,
    assertNoLockedTargets,
    buildAdminPermissionChangeDetails,
    fetchAdminRoleRowsByUserIds,
    fetchCurrentRoleInfoMap,
    fetchUserEntitlementsByUserIds,
    fetchUserProfilesByIds,
    isLockedSuperAdminEmail,
    normalizeBoolean,
    normalizeNotificationType,
    normalizeTagValue,
    normalizeUserIds,
    sanitizeText,
    shapeUserRoleInfo,
    uniqueValues
};
