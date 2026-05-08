const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { notifyUsers, notifyActiveAdmins } = require('../api/_lib/admin-notifications');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function applyFilters(rows = [], filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.operator === 'eq') {
            return String(row?.[filter.column] ?? '') === String(filter.value ?? '');
        }
        if (filter.operator === 'gte') {
            return new Date(row?.[filter.column] || 0).getTime() >= new Date(filter.value).getTime();
        }
        return true;
    }));
}

function createSelectBuilder(table, state) {
    const query = {
        filters: []
    };

    return {
        eq(column, value) {
            query.filters.push({ operator: 'eq', column, value });
            return this;
        },
        gte(column, value) {
            query.filters.push({ operator: 'gte', column, value });
            return this;
        },
        then(resolve, reject) {
            const runner = async () => {
                if (table === 'admin_roles') {
                    return {
                        data: applyFilters(state.adminRoles, query.filters),
                        error: null
                    };
                }

                if (table === 'system_notifications') {
                    return {
                        data: applyFilters(state.systemNotifications, query.filters),
                        error: null
                    };
                }

                return { data: [], error: null };
            };

            return runner().then(resolve, reject);
        }
    };
}

function createSupabaseStub(state) {
    return {
        from(table) {
            return {
                select() {
                    return createSelectBuilder(table, state);
                },
                async insert(payload) {
                    const rows = Array.isArray(payload) ? payload : [payload];

                    if (table === 'system_notifications') {
                        if (state.failScopedInsertOnce && rows.some((row) => row.scope || row.category)) {
                            state.failScopedInsertOnce = false;
                            return {
                                data: null,
                                error: {
                                    code: '42703',
                                    message: 'column "scope" does not exist'
                                }
                            };
                        }

                        rows.forEach((row, index) => {
                            state.systemNotifications.push({
                                id: row.id || `notification-${state.systemNotifications.length + index + 1}`,
                                created_at: row.created_at || new Date().toISOString(),
                                ...row
                            });
                        });
                        return {
                            data: rows,
                            error: null
                        };
                    }

                    return { data: rows, error: null };
                }
            };
        }
    };
}

test('notifyUsers applies personal notification scope defaults and dedupes within that scope', async () => {
    const state = {
        adminRoles: [],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);

    const first = await notifyUsers(supabase, {
        userIds: ['user-1'],
        title: '客服回复',
        content: '您好，这里是客服。',
        type: 'info',
        dedupeWindowMinutes: 60
    });

    assert.equal(first.created, 1);
    assert.equal(first.skipped, 0);
    assert.equal(state.systemNotifications.length, 1);
    assert.equal(state.systemNotifications[0].site, 'cn');
    assert.equal(state.systemNotifications[0].scope, 'user_personal');
    assert.equal(state.systemNotifications[0].category, 'general');
    assert.equal(state.systemNotifications[0].metadata.site, 'cn');

    const second = await notifyUsers(supabase, {
        userIds: ['user-1'],
        title: '客服回复',
        content: '您好，这里是客服。',
        type: 'info',
        dedupeWindowMinutes: 60
    });

    assert.equal(second.created, 0);
    assert.equal(second.skipped, 1);
    assert.equal(state.systemNotifications.length, 1);
});

test('notifyUsers prefers source event identity over repeated copy matching', async () => {
    const state = {
        adminRoles: [],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);

    const first = await notifyUsers(supabase, {
        userIds: ['user-1'],
        title: '订单提醒',
        content: '订单 A 已完成。',
        sourceModule: 'shop',
        sourceEventId: 'order-1',
        dedupeWindowMinutes: 60
    });

    const second = await notifyUsers(supabase, {
        userIds: ['user-1'],
        title: '新的订单提醒',
        content: '同一订单的文案发生了变化。',
        sourceModule: 'shop',
        sourceEventId: 'order-1',
        dedupeWindowMinutes: 60
    });

    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 1);
    assert.equal(state.systemNotifications.length, 1);
});

test('notifyUsers dedupes within the same site but keeps cn and intl notifications isolated', async () => {
    const state = {
        adminRoles: [],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);

    const cnResult = await notifyUsers(supabase, {
        userIds: ['user-1'],
        title: '客服回复',
        content: '您好，这里是客服。',
        site: 'cn',
        dedupeWindowMinutes: 60
    });
    const intlResult = await notifyUsers(supabase, {
        userIds: ['user-1'],
        title: '客服回复',
        content: '您好，这里是客服。',
        site: 'intl',
        dedupeWindowMinutes: 60
    });
    const cnRepeatResult = await notifyUsers(supabase, {
        userIds: ['user-1'],
        title: '客服回复',
        content: '您好，这里是客服。',
        site: 'cn',
        dedupeWindowMinutes: 60
    });

    assert.equal(cnResult.created, 1);
    assert.equal(intlResult.created, 1);
    assert.equal(cnRepeatResult.created, 0);
    assert.equal(state.systemNotifications.length, 2);
    assert.deepEqual(state.systemNotifications.map((row) => row.site).sort(), ['cn', 'intl']);
});

test('notifyActiveAdmins defaults to admin personal notification scope', async () => {
    const state = {
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);

    const result = await notifyActiveAdmins(supabase, {
        title: '系统公告',
        content: '今晚 23:00 会有一次短暂维护。'
    });

    assert.equal(result.created, 1);
    assert.equal(state.systemNotifications.length, 1);
    assert.equal(state.systemNotifications[0].scope, 'admin_personal');
    assert.equal(state.systemNotifications[0].category, 'admin_notice');
});

test('notifyUsers does not send admin personal notifications to non-admin recipients', async () => {
    const state = {
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);

    const result = await notifyUsers(supabase, {
        userIds: ['admin-1', 'user-1'],
        title: '支付通道异常汇总',
        content: '支付通道在最近窗口触发异常阈值。',
        type: 'alert',
        scope: 'admin_personal',
        category: 'admin_notice',
        dedupeWindowMinutes: 60
    });

    assert.equal(result.recipients, 2);
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 1);
    assert.equal(state.systemNotifications.length, 1);
    assert.equal(state.systemNotifications[0].user_id, 'admin-1');
    assert.equal(state.systemNotifications[0].scope, 'admin_personal');
});

test('notification inserts gracefully fall back when scope columns are not deployed yet', async () => {
    const state = {
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null }
        ],
        systemNotifications: [],
        failScopedInsertOnce: true
    };
    const supabase = createSupabaseStub(state);

    const result = await notifyActiveAdmins(supabase, {
        title: '系统公告',
        content: '兼容老库结构的回退测试。'
    });

    assert.equal(result.created, 1);
    assert.equal(state.systemNotifications.length, 1);
    assert.equal('scope' in state.systemNotifications[0], false);
    assert.equal('category' in state.systemNotifications[0], false);
    assert.equal('site' in state.systemNotifications[0], false);
});

test('notification writers tag chat replies and admin notices with scoped metadata', () => {
    const chatWidgetSource = readRepoFile(path.join('js', 'components', 'ChatWidget.js'));
    const adminUsersSource = readRepoFile('admin-users.js');
    const adminConfigSource = readRepoFile('admin-config.js');
    const adminLoginAnomalySource = readRepoFile(path.join('api', '_lib', 'admin-login-anomaly-alerts.js'));

    assert.match(chatWidgetSource, /scope:\s*'user_personal'/);
    assert.match(chatWidgetSource, /category:\s*'chat_reply'/);
    assert.match(adminUsersSource, /scope:\s*'user_personal'/);
    assert.match(adminUsersSource, /category:\s*'admin_notice'/);
    assert.match(adminConfigSource, /scope:\s*'admin_personal'/);
    assert.match(adminConfigSource, /category:\s*'announcement'/);
    assert.match(adminLoginAnomalySource, /category:\s*'security'/);
});
