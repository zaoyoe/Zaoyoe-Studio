const {
    getSupabaseAdmin,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../_lib/admin');

const TEST_ORDER_PREFIX = 'AUTO_CDX_';
const TEST_EMAIL_PATTERN = /^codex\..+@example\.com$/i;

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
            ...users.filter((user) => TEST_EMAIL_PATTERN.test(String(user.email || '').trim()))
        );

        if (users.length < perPage) break;
        page += 1;
    }

    return matchedUsers;
}

async function countLike(supabase, table, column, pattern) {
    const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .like(column, pattern);

    if (error) {
        throw new Error(error.message || `Failed to count ${table}`);
    }

    return Number(count || 0);
}

async function countIn(supabase, table, column, ids) {
    if (!Array.isArray(ids) || !ids.length) return 0;

    const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in(column, ids);

    if (error) {
        throw new Error(error.message || `Failed to count ${table}`);
    }

    return Number(count || 0);
}

async function safeDeleteIn(supabase, table, column, values) {
    if (!Array.isArray(values) || !values.length) return 0;

    const { data, error } = await supabase
        .from(table)
        .delete()
        .in(column, values)
        .select('id');

    if (error) {
        throw new Error(error.message || `Failed to delete ${table}`);
    }

    return Array.isArray(data) ? data.length : 0;
}

async function safeDeleteLike(supabase, table, column, pattern) {
    const { data, error } = await supabase
        .from(table)
        .delete()
        .like(column, pattern)
        .select('id');

    if (error) {
        throw new Error(error.message || `Failed to delete ${table}`);
    }

    return Array.isArray(data) ? data.length : 0;
}

async function buildCleanupPreview(supabaseAdmin) {
    const testUsers = await listTestUsers(supabaseAdmin);
    const testUserIds = testUsers.map((user) => user.id);

    const [
        paymentOrders,
        paymentEvents,
        afdianOrders,
        profiles,
        pointsBalances,
        pointsLedgerEntries,
        userCheckins,
        userEvents
    ] = await Promise.all([
        countLike(supabaseAdmin, 'payment_orders', 'provider_order_no', `${TEST_ORDER_PREFIX}%`),
        countLike(supabaseAdmin, 'payment_events', 'provider_order_no', `${TEST_ORDER_PREFIX}%`),
        countLike(supabaseAdmin, 'afdian_orders', 'out_trade_no', `${TEST_ORDER_PREFIX}%`),
        countIn(supabaseAdmin, 'profiles', 'id', testUserIds),
        countIn(supabaseAdmin, 'points_balance', 'user_id', testUserIds),
        countIn(supabaseAdmin, 'points_ledger', 'user_id', testUserIds),
        countIn(supabaseAdmin, 'user_checkins', 'user_id', testUserIds),
        countIn(supabaseAdmin, 'user_events', 'user_id', testUserIds)
    ]);

    return {
        order_prefix: TEST_ORDER_PREFIX,
        user_email_pattern: TEST_EMAIL_PATTERN.toString(),
        counts: {
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

module.exports = async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { user } = await requireAdmin(req);
        const supabaseAdmin = getSupabaseAdmin();
        const preview = await buildCleanupPreview(supabaseAdmin);

        const { data: sampleOrders, error: sampleOrdersError } = await supabaseAdmin
            .from('payment_orders')
            .select('id, provider_order_no, status, paid_amount, created_at')
            .like('provider_order_no', `${TEST_ORDER_PREFIX}%`)
            .order('created_at', { ascending: false })
            .limit(10);

        if (sampleOrdersError) {
            throw new Error(sampleOrdersError.message || 'Failed to load cleanup samples');
        }

        preview.samples.orders = sampleOrders || [];

        if (req.method === 'GET') {
            return sendJson(res, 200, {
                success: true,
                preview
            });
        }

        const deleted = {
            payment_events: 0,
            afdian_orders: 0,
            payment_orders: 0,
            points_ledger_user: 0,
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

        deleted.payment_events = await safeDeleteLike(supabaseAdmin, 'payment_events', 'provider_order_no', `${TEST_ORDER_PREFIX}%`);
        deleted.afdian_orders = await safeDeleteLike(supabaseAdmin, 'afdian_orders', 'out_trade_no', `${TEST_ORDER_PREFIX}%`);
        deleted.payment_orders = await safeDeleteLike(supabaseAdmin, 'payment_orders', 'provider_order_no', `${TEST_ORDER_PREFIX}%`);

        if (preview.test_user_ids.length) {
            deleted.points_ledger_user = await safeDeleteIn(supabaseAdmin, 'points_ledger', 'user_id', preview.test_user_ids);
            deleted.points_ledger_created_by = await safeDeleteIn(supabaseAdmin, 'points_ledger', 'created_by', preview.test_user_ids);
            deleted.points_balance = await safeDeleteIn(supabaseAdmin, 'points_balance', 'user_id', preview.test_user_ids);
            deleted.user_checkins = await safeDeleteIn(supabaseAdmin, 'user_checkins', 'user_id', preview.test_user_ids);
            deleted.user_events = await safeDeleteIn(supabaseAdmin, 'user_events', 'user_id', preview.test_user_ids);
            deleted.system_notifications = await safeDeleteIn(supabaseAdmin, 'system_notifications', 'user_id', preview.test_user_ids);
            deleted.admin_notes_target = await safeDeleteIn(supabaseAdmin, 'admin_notes', 'target_user_id', preview.test_user_ids);
            deleted.admin_notes_admin = await safeDeleteIn(supabaseAdmin, 'admin_notes', 'admin_id', preview.test_user_ids);
            deleted.admin_audit_logs_target = await safeDeleteIn(supabaseAdmin, 'admin_audit_logs', 'target_user_id', preview.test_user_ids);
            deleted.admin_audit_logs_admin = await safeDeleteIn(supabaseAdmin, 'admin_audit_logs', 'admin_id', preview.test_user_ids);

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
};
