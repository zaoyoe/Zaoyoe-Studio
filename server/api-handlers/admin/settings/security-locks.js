const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function buildHandlerError(statusCode, message) {
    const error = new Error(message || 'Security lock request failed');
    error.statusCode = Number(statusCode) || 500;
    return error;
}

async function fetchLockedProfiles(supabase) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, failed_login_attempts, locked_until')
        .gt('locked_until', nowIso)
        .order('locked_until', { ascending: false });

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function fetchLockedProfileEmailMap(supabase, userIds = []) {
    const normalizedUserIds = Array.from(new Set((userIds || []).map((userId) => sanitizeText(userId, 160)).filter(Boolean)));
    if (!normalizedUserIds.length) {
        return new Map();
    }

    try {
        const { data, error } = await supabase
            .from('admin_users_view')
            .select('id, email')
            .in('id', normalizedUserIds);

        if (error) {
            throw error;
        }

        return new Map((Array.isArray(data) ? data : []).map((row) => [
            sanitizeText(row?.id, 160),
            sanitizeText(row?.email, 320)
        ]));
    } catch (_) {
        return new Map();
    }
}

function shapeLockedAccounts(accounts = [], emailMap = new Map()) {
    return (Array.isArray(accounts) ? accounts : []).map((account) => {
        const userId = sanitizeText(account?.id, 160);
        const username = sanitizeText(account?.username, 255);
        const email = sanitizeText(emailMap.get(userId), 320)
            || username
            || (userId ? `${userId.slice(0, 8)}...` : '');

        return {
            id: userId,
            username,
            email,
            failed_login_attempts: Math.max(0, Number.parseInt(account?.failed_login_attempts, 10) || 0),
            locked_until: account?.locked_until || null
        };
    });
}

async function handleListLockedAccounts(supabase, res) {
    const accounts = await fetchLockedProfiles(supabase);
    const emailMap = await fetchLockedProfileEmailMap(supabase, accounts.map((account) => account.id));

    return sendJson(res, 200, {
        success: true,
        count: accounts.length,
        accounts: shapeLockedAccounts(accounts, emailMap)
    });
}

async function unlockSingleAccount(supabase, user, userId) {
    const normalizedUserId = sanitizeText(userId, 160);
    if (!normalizedUserId) {
        throw buildHandlerError(400, 'userId is required');
    }

    const { error } = await supabase
        .from('profiles')
        .update({
            failed_login_attempts: 0,
            locked_until: null
        })
        .eq('id', normalizedUserId);

    if (error) {
        throw error;
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: normalizedUserId,
        module: 'settings',
        actionType: 'security.unlock_account',
        details: {
            user_id: normalizedUserId
        }
    });

    return {
        unlockedCount: 1,
        userId: normalizedUserId
    };
}

async function unlockAllAccounts(supabase, user) {
    const lockedAccounts = await fetchLockedProfiles(supabase);
    const userIds = lockedAccounts.map((account) => sanitizeText(account?.id, 160)).filter(Boolean);

    if (userIds.length) {
        const { error } = await supabase
            .from('profiles')
            .update({
                failed_login_attempts: 0,
                locked_until: null
            })
            .in('id', userIds);

        if (error) {
            throw error;
        }
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'settings',
        actionType: 'security.unlock_all_accounts',
        details: {
            unlocked_count: userIds.length,
            user_ids: userIds
        }
    });

    return {
        unlockedCount: userIds.length
    };
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method === 'GET') {
            return handleListLockedAccounts(supabase, res);
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action, 80).toLowerCase();

        if (action === 'unlock_one') {
            const result = await unlockSingleAccount(supabase, user, body.userId || body.user_id);
            return sendJson(res, 200, {
                success: true,
                ...result
            });
        }

        if (action === 'unlock_all') {
            const result = await unlockAllAccounts(supabase, user);
            return sendJson(res, 200, {
                success: true,
                ...result
            });
        }

        return sendJson(res, 400, {
            success: false,
            message: 'Unsupported action'
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Security lock request failed'
        });
    }
};
