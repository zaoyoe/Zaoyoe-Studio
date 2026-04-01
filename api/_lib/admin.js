const { createClient } = require('@supabase/supabase-js');
const {
    getSupabasePublishableKey,
    getSupabaseUrl,
    hasSupabasePublicClientConfig
} = require('./public-runtime-config');

let supabaseAdmin = null;
let supabasePublic = null;
const ADMIN_SITE_VALUES = Object.freeze(new Set(['all', 'cn', 'intl']));
const WRITABLE_ADMIN_SITE_VALUES = Object.freeze(new Set(['cn', 'intl']));
const ADMIN_SITE_ALIASES = Object.freeze({
    global: 'all'
});

function getEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getSupabaseServiceRoleKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
        || '';
}

function getSupabaseAdmin() {
    if (supabaseAdmin) return supabaseAdmin;

    const supabaseUrl = getSupabaseUrl();
    const serviceRoleKey = getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
        throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
    }

    supabaseAdmin = createClient(
        supabaseUrl,
        serviceRoleKey,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        }
    );

    return supabaseAdmin;
}

function getOptionalSupabaseAdmin() {
    try {
        return getSupabaseAdmin();
    } catch (_) {
        return null;
    }
}

function getSupabasePublicClient() {
    if (supabasePublic) return supabasePublic;

    supabasePublic = createClient(
        getSupabaseUrl(),
        getSupabasePublishableKey(),
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        }
    );

    return supabasePublic;
}

function createSupabaseRequestClient(req) {
    const token = getBearerToken(req);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    return createClient(
        getSupabaseUrl(),
        getSupabasePublishableKey(),
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            },
            global: {
                headers
            }
        }
    );
}

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        return '';
    }
    return authHeader.slice('Bearer '.length).trim();
}

async function parseJsonBody(req) {
    if (req.body && typeof req.body === 'object') {
        return req.body;
    }

    if (typeof req.body === 'string' && req.body.trim()) {
        return JSON.parse(req.body);
    }

    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }

    if (!chunks.length) return {};

    const raw = Buffer.concat(chunks).toString('utf8').trim();
    return raw ? JSON.parse(raw) : {};
}

async function getAuthenticatedUser(req) {
    const token = getBearerToken(req);
    if (!token) {
        return { token: '', user: null };
    }

    let requestError = null;

    if (hasSupabasePublicClientConfig()) {
        const requestClient = createSupabaseRequestClient(req);
        const { data: requestData, error } = await requestClient.auth.getUser(token);
        if (!error && requestData?.user) {
            return { token, user: requestData.user };
        }
        requestError = error;
    }

    if (!getSupabaseServiceRoleKey()) {
        return { token, user: null, error: requestError };
    }

    const { data: adminData, error: adminError } = await getSupabaseAdmin().auth.getUser(token);
    if (adminError || !adminData?.user) {
        return { token, user: null, error: adminError || requestError };
    }

    return { token, user: adminData.user };
}

async function requireAuthenticatedUser(req) {
    const { user, token, error } = await getAuthenticatedUser(req);
    if (!user) {
        const authError = new Error(error?.message || 'Unauthorized');
        authError.statusCode = 401;
        throw authError;
    }

    const requestSupabase = hasSupabasePublicClientConfig()
        ? createSupabaseRequestClient(req)
        : null;
    const adminSupabase = getSupabaseServiceRoleKey()
        ? getSupabaseAdmin()
        : null;
    const supabase = requestSupabase || adminSupabase;

    return {
        user,
        token,
        supabase,
        requestSupabase,
        adminSupabase
    };
}

function normalizeAdminPermissionList(value) {
    const values = Array.isArray(value)
        ? value
        : (value ? [value] : []);

    return [...new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    )];
}

function normalizeAdminSite(value, options = {}) {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const normalizedDefault = Object.prototype.hasOwnProperty.call(options, 'defaultValue')
        ? normalizeAdminSite(options.defaultValue)
        : '';
    const normalized = String(rawValue || '').trim().toLowerCase();

    if (!normalized) {
        return normalizedDefault;
    }

    const aliased = ADMIN_SITE_ALIASES[normalized] || normalized;
    if (ADMIN_SITE_VALUES.has(aliased)) {
        return aliased;
    }

    return normalizedDefault;
}

function requireWritableAdminSite(value, options = {}) {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const rawSite = String(rawValue || '').trim();
    const normalizedSite = normalizeAdminSite(rawSite);

    if (WRITABLE_ADMIN_SITE_VALUES.has(normalizedSite)) {
        return normalizedSite;
    }

    const isExplicitAll = normalizedSite === 'all';
    const isMissing = !rawSite;
    const error = new Error(
        options.message
        || (isExplicitAll
            ? 'Writable admin site must be cn or intl; received all'
            : (isMissing
                ? 'Writable admin site is required'
                : `Writable admin site must be cn or intl; received ${rawSite}`))
    );

    error.statusCode = 400;
    error.code = isExplicitAll
        ? 'admin_site_not_writable'
        : (isMissing ? 'admin_site_required' : 'admin_site_invalid');
    error.site = normalizedSite || null;
    error.input = rawSite || null;
    throw error;
}

function collectAdminRolePermissions(roles = []) {
    const permissions = new Set();
    let isSuperAdmin = false;

    for (const role of Array.isArray(roles) ? roles : []) {
        const roleName = String(role?.role_name || '').trim().toLowerCase();
        if (roleName === 'super_admin') {
            isSuperAdmin = true;
        }

        const rolePermissions = Array.isArray(role?.permissions) ? role.permissions : [];
        for (const permission of rolePermissions) {
            const normalizedPermission = String(permission || '').trim();
            if (!normalizedPermission) continue;
            if (normalizedPermission === '*') {
                isSuperAdmin = true;
            }
            permissions.add(normalizedPermission);
        }
    }

    return {
        permissions: [...permissions],
        isSuperAdmin
    };
}

function resolveAdminPermissionRequirements(options = {}) {
    const anyOf = normalizeAdminPermissionList(options.anyOf || options.permission);
    const allOf = normalizeAdminPermissionList(options.allOf);
    return { anyOf, allOf };
}

function hasRequiredAdminPermissions(availablePermissions = [], options = {}) {
    const normalizedPermissions = normalizeAdminPermissionList(availablePermissions);
    const { anyOf, allOf } = resolveAdminPermissionRequirements(options);

    if (!anyOf.length && !allOf.length) {
        return true;
    }

    if (normalizedPermissions.includes('*')) {
        return true;
    }

    if (anyOf.length && !anyOf.some((permission) => normalizedPermissions.includes(permission))) {
        return false;
    }

    if (allOf.length && !allOf.every((permission) => normalizedPermissions.includes(permission))) {
        return false;
    }

    return true;
}

function buildAdminPermissionError(options = {}, availablePermissions = []) {
    const { anyOf, allOf } = resolveAdminPermissionRequirements(options);
    const requiredPermissions = [...new Set([...allOf, ...anyOf])];
    const error = new Error(
        options.message
        || (requiredPermissions.length
            ? `Missing required admin permission: ${requiredPermissions.join(' / ')}`
            : 'Admin permission required')
    );

    error.statusCode = 403;
    error.code = 'admin_permission_required';
    error.requiredPermissions = requiredPermissions;
    error.currentPermissions = normalizeAdminPermissionList(availablePermissions);
    return error;
}

async function requireAdmin(req, options = {}) {
    const { user, error } = await getAuthenticatedUser(req);
    if (!user) {
        const authError = new Error(error?.message || 'Unauthorized');
        authError.statusCode = 401;
        throw authError;
    }

    const requestClient = hasSupabasePublicClientConfig()
        ? createSupabaseRequestClient(req)
        : null;
    const hasServiceRole = Boolean(getSupabaseServiceRoleKey());
    const adminSupabase = hasServiceRole ? getSupabaseAdmin() : null;
    const supabase = adminSupabase || requestClient;
    const permissionClient = requestClient || adminSupabase;
    let activeRoles = [];

    // Prefer the existing permission RPC so the API stays compatible
    // during the migration from email allowlists to role-based admin auth.
    try {
        const { data: permissionData, error: permissionError } = await permissionClient
            .rpc('get_user_permissions', { p_user_id: user.id });

        if (!permissionError && (permissionData?.is_admin || permissionData?.is_super_admin)) {
            activeRoles = [{
                role_name: permissionData?.role || (permissionData?.is_super_admin ? 'super_admin' : 'admin'),
                permissions: permissionData?.permissions || [],
                expires_at: permissionData?.expires_at || null
            }];
        }
    } catch (rpcError) {
        console.warn('[AdminAPI] get_user_permissions fallback failed:', rpcError.message);
    }

    if (!activeRoles.length) {
        const { data, error: roleError } = await supabase
            .from('admin_roles')
            .select('role_name, permissions, expires_at')
            .eq('user_id', user.id);

        if (roleError) {
            const dbError = new Error(roleError.message || 'Failed to verify admin role');
            dbError.statusCode = 500;
            throw dbError;
        }

        const now = Date.now();
        activeRoles = (data || []).filter((role) => {
            if (!role?.expires_at) return true;
            return new Date(role.expires_at).getTime() > now;
        });
    }

    if (!activeRoles.length) {
        const forbiddenError = new Error('Admin access required');
        forbiddenError.statusCode = 403;
        throw forbiddenError;
    }

    const {
        permissions: resolvedPermissions,
        isSuperAdmin
    } = collectAdminRolePermissions(activeRoles);

    if (!isSuperAdmin && !hasRequiredAdminPermissions(resolvedPermissions, options)) {
        throw buildAdminPermissionError(options, resolvedPermissions);
    }

    return {
        supabase,
        requestSupabase: requestClient,
        adminSupabase,
        user,
        roles: activeRoles,
        permissions: resolvedPermissions,
        isSuperAdmin
    };
}

async function writeAdminAuditLog({
    supabase,
    adminId,
    targetUserId = null,
    actionType,
    details = {},
    site = '',
    module = ''
}) {
    if (!supabase || !adminId || !actionType) return;

    try {
        const normalizedDetails = (details && typeof details === 'object' && !Array.isArray(details))
            ? { ...details }
            : {};
        const normalizedSite = normalizeAdminSite(site);
        const normalizedModule = String(module || '').trim();

        if (normalizedSite && !Object.prototype.hasOwnProperty.call(normalizedDetails, 'site')) {
            normalizedDetails.site = normalizedSite;
        }

        if (normalizedModule && !Object.prototype.hasOwnProperty.call(normalizedDetails, 'module')) {
            normalizedDetails.module = normalizedModule;
        }

        await supabase
            .from('admin_audit_logs')
            .insert({
                admin_id: adminId,
                target_user_id: targetUserId,
                action_type: actionType,
                details: normalizedDetails
            });
    } catch (error) {
        console.warn('[AdminAPI] Failed to write audit log:', error.message);
    }
}

module.exports = {
    createSupabaseRequestClient,
    getEnv,
    getSupabaseAdmin,
    getOptionalSupabaseAdmin,
    getAuthenticatedUser,
    getBearerToken,
    getSupabasePublishableKey,
    getSupabasePublicClient,
    getSupabaseUrl,
    parseJsonBody,
    requireAuthenticatedUser,
    requireAdmin,
    requireWritableAdminSite,
    normalizeAdminPermissionList,
    normalizeAdminSite,
    hasRequiredAdminPermissions,
    sendJson,
    writeAdminAuditLog
};
