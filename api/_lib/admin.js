const { createClient } = require('@supabase/supabase-js');

let supabaseAdmin = null;

function getEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getSupabaseAdmin() {
    if (supabaseAdmin) return supabaseAdmin;

    supabaseAdmin = createClient(
        getEnv('SUPABASE_URL'),
        getEnv('SUPABASE_SERVICE_ROLE_KEY'),
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

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return { token, user: null, error };
    }

    return { token, user: data.user };
}

async function requireAdmin(req) {
    const { user, error } = await getAuthenticatedUser(req);
    if (!user) {
        const authError = new Error(error?.message || 'Unauthorized');
        authError.statusCode = 401;
        throw authError;
    }

    const supabase = getSupabaseAdmin();
    let activeRoles = [];

    // Prefer the existing permission RPC so the API stays compatible
    // during the migration from email allowlists to role-based admin auth.
    try {
        const { data: permissionData, error: permissionError } = await supabase
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

    return { supabase, user, roles: activeRoles };
}

async function writeAdminAuditLog({ supabase, adminId, targetUserId = null, actionType, details = {} }) {
    if (!supabase || !adminId || !actionType) return;

    try {
        await supabase
            .from('admin_audit_logs')
            .insert({
                admin_id: adminId,
                target_user_id: targetUserId,
                action_type: actionType,
                details
            });
    } catch (error) {
        console.warn('[AdminAPI] Failed to write audit log:', error.message);
    }
}

module.exports = {
    getEnv,
    getSupabaseAdmin,
    getBearerToken,
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
};
