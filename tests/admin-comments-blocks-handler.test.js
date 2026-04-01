const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const adminLib = require('../api/_lib/admin');

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

class FakeBlockedUsersQuery {
    constructor(state) {
        this.state = state;
        this.mode = 'select';
        this.filters = [];
        this.payload = null;
    }

    select() {
        this.mode = 'select';
        return this;
    }

    upsert(payload) {
        this.mode = 'upsert';
        this.payload = payload || {};
        return Promise.resolve(this.exec());
    }

    delete() {
        this.mode = 'delete';
        return this;
    }

    eq(field, value) {
        this.filters.push({ field, value });
        return this;
    }

    async exec() {
        if (this.mode === 'upsert') {
            const payload = deepClone(this.payload);
            const rows = this.state.blockedUsers;
            const existingIndex = rows.findIndex((row) => row.user_id === payload.user_id && row.scope === payload.scope);
            if (existingIndex >= 0) {
                rows[existingIndex] = {
                    ...rows[existingIndex],
                    ...payload
                };
            } else {
                rows.push({
                    created_at: '2026-04-01T10:00:00.000Z',
                    ...payload
                });
            }
            return { data: null, error: null };
        }

        if (this.mode === 'delete') {
            this.state.blockedUsers = this.state.blockedUsers.filter((row) => {
                return !this.filters.every((filter) => row?.[filter.field] === filter.value);
            });

            return { data: null, error: null };
        }

        const rows = this.state.blockedUsers.filter((row) => this.filters.every((filter) => row?.[filter.field] === filter.value));
        return { data: deepClone(rows), error: null };
    }

    then(resolve, reject) {
        return Promise.resolve(this.exec()).then(resolve, reject);
    }
}

class FakeBlockHistoryQuery {
    constructor(state) {
        this.state = state;
    }

    insert(payload) {
        this.state.blockHistory.push(deepClone(payload));
        return Promise.resolve({ data: null, error: null });
    }
}

async function withCommentsBlocksHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/comments/blocks.js');
    const originalLoad = Module._load;
    const state = {
        blockedUsers: deepClone(options?.blockedUsers || []),
        blockHistory: [],
        auditCalls: [],
        requireAdminCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: {
                            from(table) {
                                if (table === 'blocked_users') {
                                    return new FakeBlockedUsersQuery(state);
                                }
                                if (table === 'block_history') {
                                    return new FakeBlockHistoryQuery(state);
                                }
                                throw new Error(`Unexpected table: ${table}`);
                            }
                        },
                        user: { id: 'admin_1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                normalizeAdminSite: adminLib.normalizeAdminSite,
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditCalls.push(entry);
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
    }
}

test('comments blocks handler GET filters expired rows and expands all-scope status', async () => {
    await withCommentsBlocksHandler({
        blockedUsers: [
            {
                user_id: 'user_1',
                scope: 'all',
                reason: '全站封禁',
                expires_at: null,
                created_at: '2026-04-01T08:00:00.000Z'
            },
            {
                user_id: 'user_1',
                scope: 'gallery',
                reason: '已过期',
                expires_at: '2026-03-30T08:00:00.000Z',
                created_at: '2026-03-29T08:00:00.000Z'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/blocks?userId=user_1&site=cn',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'users.manage' });
        assert.equal(res.json().blocks.length, 1);
        assert.equal(res.json().hasGlobalBlock, true);
        assert.equal(res.json().isGuestbookBlocked, true);
        assert.equal(res.json().isGalleryBlocked, true);
    });
});

test('comments blocks handler POST rejects all-site writes before mutating ban state', async () => {
    await withCommentsBlocksHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'block',
                site: 'all',
                userId: 'user_1',
                scope: 'guestbook'
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.equal(state.blockedUsers.length, 0);
        assert.equal(state.blockHistory.length, 0);
        assert.equal(state.auditCalls.length, 0);
    });
});

test('comments blocks handler POST block writes blocked_users, block_history, and audit', async () => {
    await withCommentsBlocksHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'block',
                site: 'cn',
                userId: 'user_2',
                scope: 'gallery',
                days: 7
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.blockedUsers.length, 1);
        assert.equal(state.blockedUsers[0].user_id, 'user_2');
        assert.equal(state.blockedUsers[0].scope, 'gallery');
        assert.equal(state.blockHistory.length, 1);
        assert.equal(state.blockHistory[0].action, 'block');
        assert.equal(state.blockHistory[0].scope, 'gallery');
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'comments.block_user');
        assert.equal(res.json().isGalleryBlocked, true);
    });
});

test('comments blocks handler POST unblock clears blocked_users and writes unblock history', async () => {
    await withCommentsBlocksHandler({
        blockedUsers: [
            {
                user_id: 'user_3',
                scope: 'guestbook',
                reason: '永久封禁 留言板 权限',
                expires_at: null,
                created_at: '2026-04-01T08:00:00.000Z'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'unblock',
                site: 'intl',
                userId: 'user_3',
                scope: 'guestbook'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.blockedUsers.length, 0);
        assert.equal(state.blockHistory.length, 1);
        assert.equal(state.blockHistory[0].action, 'unblock');
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'comments.unblock_user');
        assert.equal(res.json().isGuestbookBlocked, false);
    });
});
