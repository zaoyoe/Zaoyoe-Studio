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
    return JSON.parse(JSON.stringify(value));
}

function compareDates(left, right) {
    return Date.parse(left || 0) - Date.parse(right || 0);
}

function collectCommentCascadeIds(rows, rootIds) {
    const pending = [...new Set((rootIds || []).filter(Boolean))];
    const collected = new Set(pending);

    while (pending.length) {
        const currentId = pending.shift();
        for (const row of rows || []) {
            if (!row?.id || collected.has(row.id)) continue;
            if (row.parent_id === currentId) {
                collected.add(row.id);
                pending.push(row.id);
            }
        }
    }

    return Array.from(collected);
}

class FakeQuery {
    constructor(state, table) {
        this.state = state;
        this.table = table;
        this.mode = 'select';
        this.filters = [];
        this.orderField = '';
        this.orderAscending = true;
        this.limitCount = null;
        this.selectOptions = {};
        this.payload = null;
    }

    select(_selection = '*', options = {}) {
        this.selectOptions = options || {};
        return this;
    }

    update(payload) {
        this.mode = 'update';
        this.payload = payload || {};
        return this;
    }

    delete() {
        this.mode = 'delete';
        return this;
    }

    eq(field, value) {
        this.filters.push({ op: 'eq', field, value });
        return this;
    }

    in(field, values) {
        this.filters.push({ op: 'in', field, values: Array.isArray(values) ? values : [] });
        return this;
    }

    gte(field, value) {
        this.filters.push({ op: 'gte', field, value });
        return this;
    }

    lt(field, value) {
        this.filters.push({ op: 'lt', field, value });
        return this;
    }

    not(field, operator, value) {
        this.filters.push({ op: 'not', field, operator, value });
        return this;
    }

    order(field, { ascending = true } = {}) {
        this.orderField = field;
        this.orderAscending = ascending;
        return this;
    }

    limit(count) {
        this.limitCount = count;
        return this;
    }

    then(resolve, reject) {
        return Promise.resolve(this.exec()).then(resolve, reject);
    }

    async single() {
        const result = await this.exec();
        const rows = Array.isArray(result.data) ? result.data : [];
        if (!rows.length) {
            return {
                data: null,
                error: {
                    code: 'PGRST116',
                    message: 'not found'
                }
            };
        }

        return {
            data: rows[0],
            error: null
        };
    }

    getRows() {
        return this.state.tables[this.table] || [];
    }

    matchesFilter(row, filter) {
        const value = row?.[filter.field];

        switch (filter.op) {
            case 'eq':
                return value === filter.value;
            case 'in':
                return filter.values.includes(value);
            case 'gte':
                return compareDates(value, filter.value) >= 0;
            case 'lt':
                return compareDates(value, filter.value) < 0;
            case 'not':
                if (filter.operator === 'is' && filter.value === null) {
                    return value !== null && value !== undefined;
                }
                return value !== filter.value;
            default:
                return true;
        }
    }

    applyFilters(rows) {
        let nextRows = [...rows];

        for (const filter of this.filters) {
            nextRows = nextRows.filter((row) => this.matchesFilter(row, filter));
        }

        if (this.orderField) {
            nextRows.sort((left, right) => {
                const comparison = compareDates(left?.[this.orderField], right?.[this.orderField]);
                return this.orderAscending ? comparison : -comparison;
            });
        }

        if (Number.isFinite(this.limitCount)) {
            nextRows = nextRows.slice(0, this.limitCount);
        }

        return nextRows;
    }

    deleteRows(rows) {
        if (!rows.length) {
            return [];
        }

        const idsToDelete = new Set(rows.map((row) => row.id).filter(Boolean));

        if (this.table === 'guestbook_comments') {
            const cascadedIds = collectCommentCascadeIds(this.getRows(), Array.from(idsToDelete));
            cascadedIds.forEach((id) => idsToDelete.add(id));
        }

        if (this.table === 'guestbook_messages') {
            const relatedComments = (this.state.tables.guestbook_comments || []).filter((row) => idsToDelete.has(row.message_id));
            const cascadedCommentIds = collectCommentCascadeIds(this.state.tables.guestbook_comments || [], relatedComments.map((row) => row.id));
            if (cascadedCommentIds.length) {
                this.state.tables.guestbook_comments = (this.state.tables.guestbook_comments || []).filter((row) => !cascadedCommentIds.includes(row.id));
            }
        }

        const deletedRows = this.getRows().filter((row) => idsToDelete.has(row.id));
        this.state.tables[this.table] = this.getRows().filter((row) => !idsToDelete.has(row.id));
        return deletedRows;
    }

    updateRows(rows) {
        if (!rows.length) {
            return [];
        }

        const matchedIds = new Set(rows.map((row) => row.id).filter(Boolean));
        const nextRows = this.getRows().map((row) => {
            if (!matchedIds.has(row.id)) return row;
            return {
                ...row,
                ...deepClone(this.payload)
            };
        });

        this.state.tables[this.table] = nextRows;
        return nextRows.filter((row) => matchedIds.has(row.id));
    }

    async exec() {
        const matchedRows = this.applyFilters(this.getRows());

        if (this.mode === 'delete') {
            return {
                data: this.deleteRows(matchedRows),
                error: null
            };
        }

        if (this.mode === 'update') {
            return {
                data: this.updateRows(matchedRows),
                error: null
            };
        }

        if (this.selectOptions?.head && this.selectOptions?.count === 'exact') {
            return {
                data: null,
                count: matchedRows.length,
                error: null
            };
        }

        return {
            data: deepClone(matchedRows),
            error: null
        };
    }
}

function createMockSupabase(state) {
    return {
        from(table) {
            state.fromCalls.push(table);
            return new FakeQuery(state, table);
        }
    };
}

async function withCommentsHandler(relativePath, options, callback) {
    const handlerPath = path.resolve(__dirname, relativePath);
    const originalLoad = Module._load;
    const state = {
        tables: {
            guestbook_messages: deepClone(options?.tables?.guestbook_messages || []),
            guestbook_comments: deepClone(options?.tables?.guestbook_comments || []),
            guestbook_likes: deepClone(options?.tables?.guestbook_likes || []),
            prompt_comments: deepClone(options?.tables?.prompt_comments || [])
        },
        fromCalls: [],
        requireAdminCalls: [],
        auditCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: createMockSupabase(state),
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

test('comments summary handler aggregates guestbook messages, guestbook replies, and gallery comments', async () => {
    const now = new Date().toISOString();

    await withCommentsHandler('../server/api-handlers/admin/comments/summary.js', {
        tables: {
            guestbook_messages: [
                { id: 'm1', site: 'cn', user_id: 'u1', created_at: now },
                { id: 'm2', site: 'intl', user_id: 'u9', created_at: now }
            ],
            guestbook_comments: [
                { id: 'c1', site: 'cn', user_id: 'u2', created_at: now }
            ],
            prompt_comments: [
                { id: 'g1', site: 'cn', user_id: 'u1', created_at: now }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/summary?site=cn',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'content.moderate' });
        assert.equal(res.json().summary.totalCount, 3);
        assert.equal(res.json().summary.todayCount, 3);
        assert.equal(res.json().summary.activeUsersCount, 2);
        assert.equal(res.json().site, 'cn');
    });
});

test('comments list handler returns guestbook messages, replies, and like counts for the selected site', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            guestbook_messages: [
                {
                    id: 'm1',
                    site: 'cn',
                    content: 'hello',
                    user_id: 'u1',
                    created_at: '2026-03-31T10:00:00.000Z',
                    image_url: null,
                    like_count: 5,
                    profiles: { username: 'alice', avatar_url: null, email: 'alice@example.com' }
                },
                {
                    id: 'm2',
                    site: 'intl',
                    content: 'world',
                    user_id: 'u9',
                    created_at: '2026-03-31T08:00:00.000Z',
                    image_url: null,
                    like_count: 1,
                    profiles: { username: 'bob', avatar_url: null, email: 'bob@example.com' }
                }
            ],
            guestbook_comments: [
                {
                    id: 'c1',
                    site: 'cn',
                    message_id: 'm1',
                    parent_id: null,
                    content: 'first reply',
                    user_id: 'u2',
                    created_at: '2026-03-31T10:05:00.000Z',
                    profiles: { username: 'charlie', avatar_url: null, email: 'charlie@example.com' }
                },
                {
                    id: 'c2',
                    site: 'cn',
                    message_id: 'm1',
                    parent_id: 'c1',
                    content: 'nested reply',
                    user_id: 'u3',
                    created_at: '2026-03-31T10:06:00.000Z',
                    profiles: { username: 'diana', avatar_url: null, email: 'diana@example.com' }
                },
                {
                    id: 'c3',
                    site: 'intl',
                    message_id: 'm2',
                    parent_id: null,
                    content: 'intl reply',
                    user_id: 'u4',
                    created_at: '2026-03-31T08:05:00.000Z',
                    profiles: { username: 'eva', avatar_url: null, email: 'eva@example.com' }
                }
            ],
            guestbook_likes: [
                { id: 'l1', site: 'cn', target_type: 'comment', target_id: 'c1' },
                { id: 'l2', site: 'cn', target_type: 'comment', target_id: 'c1' },
                { id: 'l3', site: 'cn', target_type: 'comment', target_id: 'c2' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=guestbook&site=cn',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 3);

        const [replyRow, commentRow, messageRow] = res.json().comments;
        assert.equal(replyRow.id, 'c2');
        assert.equal(replyRow.record_type, 'reply');
        assert.equal(replyRow.likes, 1);

        assert.equal(commentRow.id, 'c1');
        assert.equal(commentRow.record_type, 'comment');
        assert.equal(commentRow.reply_count, 1);
        assert.equal(commentRow.likes, 2);

        assert.equal(messageRow.id, 'm1');
        assert.equal(messageRow.record_type, 'message');
        assert.equal(messageRow.reply_count, 2);
        assert.equal(messageRow.site, 'cn');
    });
});

test('comments moderate handler rejects all-site writes before mutating records', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/moderate.js', {}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'delete_many',
                site: 'all',
                items: [{ id: 'c1', type: 'guestbook', recordType: 'comment' }]
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.equal(state.auditCalls.length, 0);
    });
});

test('comments moderate handler deletes guestbook reply trees, clears likes, and writes audit', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/moderate.js', {
        tables: {
            guestbook_comments: [
                { id: 'c1', site: 'cn', message_id: 'm1', parent_id: null },
                { id: 'c2', site: 'cn', message_id: 'm1', parent_id: 'c1' }
            ],
            guestbook_likes: [
                { id: 'l1', site: 'cn', target_type: 'comment', target_id: 'c1' },
                { id: 'l2', site: 'cn', target_type: 'comment', target_id: 'c2' },
                { id: 'l3', site: 'intl', target_type: 'comment', target_id: 'c1' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'delete_many',
                site: 'cn',
                items: [{ id: 'c1', type: 'guestbook', recordType: 'comment' }]
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().deletedCount, 1);
        assert.equal(state.tables.guestbook_comments.length, 0);
        assert.deepEqual(
            state.tables.guestbook_likes.map((row) => row.id),
            ['l3']
        );
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'comments.delete');
        assert.equal(state.auditCalls[0].site, 'cn');
    });
});

test('comments moderate handler toggles gallery pin state per site and writes audit', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/moderate.js', {
        tables: {
            prompt_comments: [
                { id: 'g1', site: 'cn', prompt_id: 'p1', is_pinned: true },
                { id: 'g2', site: 'cn', prompt_id: 'p1', is_pinned: false },
                { id: 'g3', site: 'intl', prompt_id: 'p1', is_pinned: true }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'toggle_pin',
                site: 'cn',
                id: 'g2',
                promptId: 'p1',
                currentStatus: false
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comment.id, 'g2');
        assert.equal(res.json().comment.is_pinned, true);

        const promptRows = state.tables.prompt_comments;
        assert.equal(promptRows.find((row) => row.id === 'g1')?.is_pinned, false);
        assert.equal(promptRows.find((row) => row.id === 'g2')?.is_pinned, true);
        assert.equal(promptRows.find((row) => row.id === 'g3')?.is_pinned, true);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'comments.pin');
        assert.equal(state.auditCalls[0].site, 'cn');
    });
});
