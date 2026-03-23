const {
    getSupabaseAdmin,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const TEST_ORDER_PREFIXES = ['AUTO_CDX_', 'SMOKE_'];
const TEST_EMAIL_PATTERNS = [
    /^codex\..+@example\.com$/i,
    /^smoke-payment-.+@zaoyoe\.invalid$/i
];

function isMissingRelationError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42P01'
        || message.includes('does not exist')
        || message.includes('failed to count')
        || message.includes('could not find the table');
}

function matchesTestUserEmail(value) {
    const email = String(value || '').trim();
    if (!email) return false;
    return TEST_EMAIL_PATTERNS.some((pattern) => pattern.test(email));
}

async function listTestUsers(supabaseAdmin) {
    const matchedUsers = [];
    let page = 1;
    const perPage = 200;

    while (true) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage
        });

        if (error) {
            throw new Error(error.message || 'Failed to list auth users');
        }

        const users = data?.users || [];
        matchedUsers.push(
            ...users.filter((user) => matchesTestUserEmail(user.email))
        );

        if (users.length < perPage) break;
        page += 1;
    }

    return matchedUsers;
}

async function countLike(supabase, table, column, pattern) {
    const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .like(column, pattern);

    if (error) {
        const wrapped = new Error(error.message || `Failed to count ${table}`);
        wrapped.code = error.code;
        wrapped.details = error.details;
        throw wrapped;
    }

    return Number(count || 0);
}

async function countLikeOptional(supabase, table, column, pattern) {
    try {
        return await countLike(supabase, table, column, pattern);
    } catch (error) {
        if (isMissingRelationError(error)) {
            return 0;
        }
        throw error;
    }
}

async function countLikePatterns(supabase, table, column, prefixes, { optional = false } = {}) {
    const executor = optional ? countLikeOptional : countLike;
    const counts = await Promise.all(
        (Array.isArray(prefixes) ? prefixes : [])
            .map((prefix) => String(prefix || '').trim())
            .filter(Boolean)
            .map((prefix) => executor(supabase, table, column, `${prefix}%`))
    );

    return counts.reduce((sum, value) => sum + Number(value || 0), 0);
}

async function countIn(supabase, table, column, ids) {
    if (!Array.isArray(ids) || !ids.length) return 0;

    const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .in(column, ids);

    if (error) {
        const wrapped = new Error(error.message || `Failed to count ${table}`);
        wrapped.code = error.code;
        wrapped.details = error.details;
        throw wrapped;
    }

    return Number(count || 0);
}

async function countInOptional(supabase, table, column, ids) {
    try {
        return await countIn(supabase, table, column, ids);
    } catch (error) {
        if (isMissingRelationError(error)) {
            return 0;
        }
        throw error;
    }
}

async function safeDeleteIn(supabase, table, column, values) {
    if (!Array.isArray(values) || !values.length) return 0;

    const { data, error } = await supabase
        .from(table)
        .delete()
        .in(column, values)
        .select('*');

    if (error) {
        const wrapped = new Error(error.message || `Failed to delete ${table}`);
        wrapped.code = error.code;
        wrapped.details = error.details;
        throw wrapped;
    }

    return Array.isArray(data) ? data.length : 0;
}

async function safeDeleteInOptional(supabase, table, column, values) {
    try {
        return await safeDeleteIn(supabase, table, column, values);
    } catch (error) {
        if (isMissingRelationError(error)) {
            return 0;
        }
        throw error;
    }
}

async function safeDeleteLike(supabase, table, column, pattern) {
    const { data, error } = await supabase
        .from(table)
        .delete()
        .like(column, pattern)
        .select('*');

    if (error) {
        const wrapped = new Error(error.message || `Failed to delete ${table}`);
        wrapped.code = error.code;
        wrapped.details = error.details;
        throw wrapped;
    }

    return Array.isArray(data) ? data.length : 0;
}

async function safeDeleteLikeOptional(supabase, table, column, pattern) {
    try {
        return await safeDeleteLike(supabase, table, column, pattern);
    } catch (error) {
        if (isMissingRelationError(error)) {
            return 0;
        }
        throw error;
    }
}

async function safeDeleteLikePatternsOptional(supabase, table, column, prefixes) {
    const deletedCounts = await Promise.all(
        (Array.isArray(prefixes) ? prefixes : [])
            .map((prefix) => String(prefix || '').trim())
            .filter(Boolean)
            .map((prefix) => safeDeleteLikeOptional(supabase, table, column, `${prefix}%`))
    );

    return deletedCounts.reduce((sum, value) => sum + Number(value || 0), 0);
}

function compareDescendingByCreatedAt(left, right) {
    const leftValue = Date.parse(left?.created_at || 0) || 0;
    const rightValue = Date.parse(right?.created_at || 0) || 0;
    return rightValue - leftValue;
}

async function selectLikePatterns(supabase, table, column, prefixes, options = {}) {
    const {
        select = '*',
        limit = 10,
        orderColumn = 'created_at',
        ascending = false,
        optional = false
    } = options || {};
    const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 10);
    const queries = (Array.isArray(prefixes) ? prefixes : [])
        .map((prefix) => String(prefix || '').trim())
        .filter(Boolean)
        .map(async (prefix) => {
            const { data, error } = await supabase
                .from(table)
                .select(select)
                .like(column, `${prefix}%`)
                .order(orderColumn, { ascending })
                .limit(safeLimit);

            if (error) {
                if (optional && isMissingRelationError(error)) {
                    return [];
                }
                const wrapped = new Error(error.message || `Failed to fetch ${table}`);
                wrapped.code = error.code;
                wrapped.details = error.details;
                throw wrapped;
            }

            return Array.isArray(data) ? data : [];
        });

    const rows = (await Promise.all(queries)).flat().sort(compareDescendingByCreatedAt);
    const uniqueRows = [];
    const seen = new Set();

    for (const row of rows) {
        const dedupeKey = String(row?.id || row?.[column] || JSON.stringify(row));
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        uniqueRows.push(row);
        if (uniqueRows.length >= safeLimit) break;
    }

    return uniqueRows;
}

async function buildCleanupPreview(supabaseAdmin) {
    const testUsers = await listTestUsers(supabaseAdmin);
    const testUserIds = testUsers.map((user) => user.id);

    const [
        paymentCheckoutSessions,
        paymentOrders,
        paymentEvents,
        afdianOrders,
        profiles,
        pointsBalances,
        pointsLedgerEntries,
        userCheckins,
        userEvents
    ] = await Promise.all([
        countInOptional(supabaseAdmin, 'payment_checkout_sessions', 'user_id', testUserIds),
        countLikePatterns(supabaseAdmin, 'payment_orders', 'provider_order_no', TEST_ORDER_PREFIXES),
        countLikePatterns(supabaseAdmin, 'payment_events', 'provider_order_no', TEST_ORDER_PREFIXES),
        countLikePatterns(supabaseAdmin, 'afdian_orders', 'out_trade_no', TEST_ORDER_PREFIXES),
        countInOptional(supabaseAdmin, 'profiles', 'id', testUserIds),
        countInOptional(supabaseAdmin, 'points_balance', 'user_id', testUserIds),
        countInOptional(supabaseAdmin, 'points_ledger', 'user_id', testUserIds),
        countInOptional(supabaseAdmin, 'user_checkins', 'user_id', testUserIds),
        countInOptional(supabaseAdmin, 'user_events', 'user_id', testUserIds)
    ]);

    return {
        order_prefix: TEST_ORDER_PREFIXES[0],
        user_email_pattern: TEST_EMAIL_PATTERNS[0].toString(),
        order_prefixes: [...TEST_ORDER_PREFIXES],
        user_email_patterns: TEST_EMAIL_PATTERNS.map((pattern) => pattern.toString()),
        counts: {
            payment_checkout_sessions: paymentCheckoutSessions,
            payment_orders: paymentOrders,
            payment_events: paymentEvents,
            afdian_orders: afdianOrders,
            auth_users: testUsers.length,
            profiles,
            points_balance: pointsBalances,
            points_ledger: pointsLedgerEntries,
            user_checkins: userCheckins,
            user_events: userEvents
        },
        samples: {
            orders: [],
            users: testUsers.slice(0, 10).map((user) => ({
                id: user.id,
                email: user.email || ''
            }))
        },
        test_user_ids: testUserIds
    };
}

async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { user } = await requireAdmin(req);
        const supabaseAdmin = getSupabaseAdmin();
        const preview = await buildCleanupPreview(supabaseAdmin);

        preview.samples.orders = await selectLikePatterns(
            supabaseAdmin,
            'payment_orders',
            'provider_order_no',
            TEST_ORDER_PREFIXES,
            {
                select: 'id, provider_order_no, status, paid_amount, created_at',
                limit: 10,
                orderColumn: 'created_at',
                ascending: false
            }
        );

        if (req.method === 'GET') {
            return sendJson(res, 200, {
                success: true,
                preview
            });
        }

        const deleted = {
            payment_checkout_sessions: 0,
            payment_events: 0,
            afdian_orders: 0,
            payment_orders: 0,
            points_ledger_user: 0,
            points_ledger_reference: 0,
            points_ledger_created_by: 0,
            points_balance: 0,
            user_checkins: 0,
            user_events: 0,
            system_notifications: 0,
            admin_notes_target: 0,
            admin_notes_admin: 0,
            admin_audit_logs_target: 0,
            admin_audit_logs_admin: 0,
            auth_users: 0
        };
        const warnings = [];

        deleted.payment_checkout_sessions = await safeDeleteInOptional(supabaseAdmin, 'payment_checkout_sessions', 'user_id', preview.test_user_ids);
        deleted.payment_events = await safeDeleteLikePatternsOptional(supabaseAdmin, 'payment_events', 'provider_order_no', TEST_ORDER_PREFIXES);
        deleted.afdian_orders = await safeDeleteLikePatternsOptional(supabaseAdmin, 'afdian_orders', 'out_trade_no', TEST_ORDER_PREFIXES);
        deleted.payment_orders = await safeDeleteLikePatternsOptional(supabaseAdmin, 'payment_orders', 'provider_order_no', TEST_ORDER_PREFIXES);
        deleted.points_ledger_reference = await safeDeleteLikePatternsOptional(
            supabaseAdmin,
            'points_ledger',
            'reference_id',
            TEST_ORDER_PREFIXES.map((prefix) => `mock_${prefix}`)
        );

        if (preview.test_user_ids.length) {
            deleted.points_ledger_user = await safeDeleteInOptional(supabaseAdmin, 'points_ledger', 'user_id', preview.test_user_ids);
            deleted.points_ledger_created_by = await safeDeleteInOptional(supabaseAdmin, 'points_ledger', 'created_by', preview.test_user_ids);
            deleted.points_balance = await safeDeleteInOptional(supabaseAdmin, 'points_balance', 'user_id', preview.test_user_ids);
            deleted.user_checkins = await safeDeleteInOptional(supabaseAdmin, 'user_checkins', 'user_id', preview.test_user_ids);
            deleted.user_events = await safeDeleteInOptional(supabaseAdmin, 'user_events', 'user_id', preview.test_user_ids);
            deleted.system_notifications = await safeDeleteInOptional(supabaseAdmin, 'system_notifications', 'user_id', preview.test_user_ids);
            deleted.admin_notes_target = await safeDeleteInOptional(supabaseAdmin, 'admin_notes', 'target_user_id', preview.test_user_ids);
            deleted.admin_notes_admin = await safeDeleteInOptional(supabaseAdmin, 'admin_notes', 'admin_id', preview.test_user_ids);
            deleted.admin_audit_logs_target = await safeDeleteInOptional(supabaseAdmin, 'admin_audit_logs', 'target_user_id', preview.test_user_ids);
            deleted.admin_audit_logs_admin = await safeDeleteInOptional(supabaseAdmin, 'admin_audit_logs', 'admin_id', preview.test_user_ids);

            for (const testUserId of preview.test_user_ids) {
                const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(testUserId);
                if (deleteUserError) {
                    warnings.push({
                        user_id: testUserId,
                        message: deleteUserError.message || 'Failed to delete auth user'
                    });
                } else {
                    deleted.auth_users += 1;
                }
            }
        }

        await writeAdminAuditLog({
            supabase: supabaseAdmin,
            adminId: user.id,
            actionType: 'payments.cleanup_test_data',
            details: {
                preview: preview.counts,
                deleted,
                warnings
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: warnings.length
                ? '测试数据已清理，部分测试账号需要人工复查。'
                : '测试数据已清理完成。',
            preview,
            deleted,
            warnings
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        return sendJson(res, statusCode, {
            success: false,
            message: error.message || 'Failed to clean test data'
        });
    }
}

module.exports = handler;
module.exports._private = {
    TEST_ORDER_PREFIXES,
    TEST_EMAIL_PATTERNS,
    buildCleanupPreview,
    countLikePatterns,
    listTestUsers,
    matchesTestUserEmail,
    safeDeleteLikePatternsOptional,
    selectLikePatterns
};
