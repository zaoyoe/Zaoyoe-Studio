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
        this.upsertConflictFields = [];
    }

    select(_selection = '*', options = {}) {
        this.selectOptions = options || {};
        return this;
    }

    insert(payload) {
        this.mode = 'insert';
        this.payload = Array.isArray(payload) ? payload : [payload || {}];
        return this;
    }

    upsert(payload, options = {}) {
        this.mode = 'upsert';
        this.payload = Array.isArray(payload) ? payload : [payload || {}];
        this.upsertConflictFields = String(options?.onConflict || '')
            .split(',')
            .map((field) => String(field || '').trim())
            .filter(Boolean);
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

    async maybeSingle() {
        const result = await this.exec();
        const rows = Array.isArray(result.data) ? result.data : [];
        return {
            data: rows[0] || null,
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

    generateRowId() {
        this.state.rowCounter += 1;
        return `${this.table}_${this.state.rowCounter}`;
    }

    normalizeInsertRow(row) {
        const normalized = deepClone(row || {});
        if (!normalized.id) {
            normalized.id = this.generateRowId();
        }
        if (!normalized.created_at) {
            normalized.created_at = '2026-04-09T00:00:00.000Z';
        }
        if (!normalized.updated_at) {
            normalized.updated_at = normalized.created_at;
        }
        return normalized;
    }

    insertRows() {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload])
            .map((row) => this.normalizeInsertRow(row));
        this.state.tables[this.table] = [...this.getRows(), ...rows];
        return rows;
    }

    upsertRows() {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => deepClone(row || {}));
        const currentRows = [...this.getRows()];
        const nextRows = [...currentRows];
        const touchedRows = [];

        rows.forEach((incoming) => {
            const matchIndex = nextRows.findIndex((existing) => this.upsertConflictFields.every((field) => existing?.[field] === incoming?.[field]));
            if (matchIndex >= 0) {
                nextRows[matchIndex] = {
                    ...nextRows[matchIndex],
                    ...incoming,
                    updated_at: incoming.updated_at || nextRows[matchIndex].updated_at || '2026-04-09T00:00:00.000Z'
                };
                touchedRows.push(nextRows[matchIndex]);
                return;
            }

            const inserted = this.normalizeInsertRow(incoming);
            nextRows.push(inserted);
            touchedRows.push(inserted);
        });

        this.state.tables[this.table] = nextRows;
        return touchedRows;
    }

    async exec() {
        const matchedRows = this.applyFilters(this.getRows());

        if (this.mode === 'insert') {
            return {
                data: this.insertRows(),
                error: null
            };
        }

        if (this.mode === 'upsert') {
            return {
                data: this.upsertRows(),
                error: null
            };
        }

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
            blocked_users: deepClone(options?.tables?.blocked_users || []),
            prompt_comments: deepClone(options?.tables?.prompt_comments || []),
            profiles: deepClone(options?.tables?.profiles || []),
            prompts: deepClone(options?.tables?.prompts || []),
            comment_likes: deepClone(options?.tables?.comment_likes || []),
            admin_comment_workflows: deepClone(options?.tables?.admin_comment_workflows || []),
            admin_comment_workflow_notes: deepClone(options?.tables?.admin_comment_workflow_notes || []),
            admin_comment_ticket_links: deepClone(options?.tables?.admin_comment_ticket_links || []),
            shop_tickets: deepClone(options?.tables?.shop_tickets || []),
            shop_orders: deepClone(options?.tables?.shop_orders || []),
            payment_orders: deepClone(options?.tables?.payment_orders || []),
            block_history: deepClone(options?.tables?.block_history || [])
        },
        fromCalls: [],
        requireAdminCalls: [],
        auditCalls: [],
        rowCounter: 0
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
        assert.deepEqual(state.requireAdminCalls[0]?.config, { anyOf: ['content.moderate', 'analytics.view'] });
        assert.equal(res.json().summary.totalCount, 3);
        assert.equal(res.json().summary.todayCount, 3);
        assert.equal(res.json().summary.activeUsersCount, 2);
        assert.equal(res.json().summary.totalMessages, 1);
        assert.equal(res.json().summary.totalComments, 2);
        assert.equal(res.json().summary.totalReplies, 0);
        assert.equal(res.json().summary.openGovernanceCount, 3);
        assert.equal(res.json().summary.queueCounts.pending, 3);
        assert.equal(res.json().site, 'cn');
    });
});

test('comments summary handler scopes stats to the guestbook tab when view=guestbook', async () => {
    const now = new Date().toISOString();

    await withCommentsHandler('../server/api-handlers/admin/comments/summary.js', {
        tables: {
            guestbook_messages: [
                { id: 'm1', site: 'cn', user_id: 'u1', created_at: now }
            ],
            guestbook_comments: [
                { id: 'c1', site: 'cn', user_id: 'u2', message_id: 'm1', parent_id: null, created_at: now },
                { id: 'c2', site: 'cn', user_id: 'u3', message_id: 'm1', parent_id: 'c1', created_at: now }
            ],
            prompt_comments: [
                { id: 'g1', site: 'cn', user_id: 'u9', parent_id: null, created_at: now }
            ],
            blocked_users: [
                { id: 'b1', user_id: 'u1', scope: 'guestbook', expires_at: null }
            ],
            admin_comment_workflows: [
                {
                    id: 'wf1',
                    site: 'cn',
                    entity_type: 'guestbook_message',
                    entity_id: 'm1',
                    status: 'escalated',
                    priority: 'high',
                    linked_ticket_count: 1,
                    tags: ['risk']
                },
                {
                    id: 'wf2',
                    site: 'cn',
                    entity_type: 'prompt_comment',
                    entity_id: 'g1',
                    status: 'escalated',
                    priority: 'high',
                    linked_ticket_count: 1,
                    tags: ['risk']
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/summary?site=cn&view=guestbook',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().view, 'guestbook');
        assert.equal(res.json().summary.totalCount, 3);
        assert.equal(res.json().summary.totalMessages, 1);
        assert.equal(res.json().summary.totalComments, 1);
        assert.equal(res.json().summary.totalReplies, 1);
        assert.equal(res.json().summary.openGovernanceCount, 3);
        assert.equal(res.json().summary.queueCounts.pending, 3);
        assert.equal(res.json().summary.queueCounts.guestbook_unreplied, 0);
        assert.equal(res.json().summary.queueCounts.blocked_user, 1);
        assert.equal(res.json().summary.queueCounts.escalated, 1);
        assert.equal(res.json().summary.queueCounts.high_risk, 1);
    });
});

test('comments summary handler scopes stats to the gallery tab when view=gallery', async () => {
    const now = new Date().toISOString();

    await withCommentsHandler('../server/api-handlers/admin/comments/summary.js', {
        tables: {
            guestbook_messages: [
                { id: 'm1', site: 'cn', user_id: 'u1', created_at: now },
                { id: 'm2', site: 'cn', user_id: 'u8', created_at: now }
            ],
            guestbook_comments: [
                { id: 'c1', site: 'cn', user_id: 'u2', message_id: 'm1', parent_id: null, created_at: now }
            ],
            prompt_comments: [
                { id: 'g1', site: 'cn', user_id: 'u9', parent_id: null, created_at: now },
                { id: 'g2', site: 'cn', user_id: 'u9', parent_id: 'g1', created_at: now }
            ],
            blocked_users: [
                { id: 'b1', user_id: 'u9', scope: 'gallery', expires_at: null }
            ],
            admin_comment_workflows: [
                {
                    id: 'wf1',
                    site: 'cn',
                    entity_type: 'guestbook_comment',
                    entity_id: 'c1',
                    status: 'escalated',
                    priority: 'high',
                    linked_ticket_count: 1,
                    tags: ['risk']
                },
                {
                    id: 'wf2',
                    site: 'cn',
                    entity_type: 'prompt_comment',
                    entity_id: 'g1',
                    status: 'escalated',
                    priority: 'high',
                    linked_ticket_count: 1,
                    tags: ['risk']
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/summary?site=cn&view=gallery',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().view, 'gallery');
        assert.equal(res.json().summary.totalCount, 2);
        assert.equal(res.json().summary.totalMessages, 0);
        assert.equal(res.json().summary.totalComments, 1);
        assert.equal(res.json().summary.totalReplies, 1);
        assert.equal(res.json().summary.openGovernanceCount, 2);
        assert.equal(res.json().summary.queueCounts.pending, 2);
        assert.equal(res.json().summary.queueCounts.guestbook_unreplied, 1);
        assert.equal(res.json().summary.queueCounts.blocked_user, 2);
        assert.equal(res.json().summary.queueCounts.escalated, 1);
        assert.equal(res.json().summary.queueCounts.high_risk, 2);
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
                    like_count: 5
                },
                {
                    id: 'm2',
                    site: 'intl',
                    content: 'world',
                    user_id: 'u9',
                    created_at: '2026-03-31T08:00:00.000Z',
                    image_url: null,
                    like_count: 1
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
                    created_at: '2026-03-31T10:05:00.000Z'
                },
                {
                    id: 'c2',
                    site: 'cn',
                    message_id: 'm1',
                    parent_id: 'c1',
                    content: 'nested reply',
                    user_id: 'u3',
                    created_at: '2026-03-31T10:06:00.000Z'
                },
                {
                    id: 'c3',
                    site: 'intl',
                    message_id: 'm2',
                    parent_id: null,
                    content: 'intl reply',
                    user_id: 'u4',
                    created_at: '2026-03-31T08:05:00.000Z'
                }
            ],
            profiles: [
                { id: 'u1', username: 'alice', avatar_url: null, email: 'alice@example.com' },
                { id: 'u2', username: 'charlie', avatar_url: null, email: 'charlie@example.com' },
                { id: 'u3', username: 'diana', avatar_url: null, email: 'diana@example.com' },
                { id: 'u4', username: 'eva', avatar_url: null, email: 'eva@example.com' }
            ],
            guestbook_likes: [
                { id: 'l1', site: 'cn', target_type: 'comment', target_id: 'c1' },
                { id: 'l2', site: 'cn', target_type: 'comment', target_id: 'c1' },
                { id: 'l3', site: 'cn', target_type: 'comment', target_id: 'c2' }
            ],
            blocked_users: [
                { user_id: 'u2', scope: 'guestbook', reason: 'spam', expires_at: null },
                { user_id: 'u3', scope: 'all', reason: 'abuse', expires_at: null }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=guestbook&site=cn',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 3);
        assert.equal(res.json().pagination.page, 1);
        assert.equal(res.json().pagination.pageSize, 40);
        assert.equal(res.json().pagination.totalItems, 3);
        assert.equal(res.json().pagination.totalPages, 1);

        const [replyRow, commentRow, messageRow] = res.json().comments;
        assert.equal(replyRow.id, 'c2');
        assert.equal(replyRow.record_type, 'reply');
        assert.equal(replyRow.likes, 1);
        assert.equal(replyRow.entity_type, 'guestbook_comment');
        assert.equal(replyRow.thread_root_id, 'm1');

        assert.equal(commentRow.id, 'c1');
        assert.equal(commentRow.record_type, 'comment');
        assert.equal(commentRow.level, 'top');
        assert.equal(commentRow.reply_count, 1);
        assert.equal(commentRow.likes, 2);
        assert.equal(commentRow.user_block_state?.isGuestbookBlocked, true);
        assert.equal(commentRow.user_block_state?.hasGlobalBlock, false);

        assert.equal(messageRow.id, 'm1');
        assert.equal(messageRow.record_type, 'message');
        assert.equal(messageRow.entity_type, 'guestbook_message');
        assert.equal(messageRow.reply_count, 2);
        assert.equal(messageRow.site, 'cn');
        assert.equal(messageRow.user_block_state?.isGuestbookBlocked, false);

        assert.equal(replyRow.user_block_state?.hasGlobalBlock, true);
        assert.equal(replyRow.user_block_state?.isGuestbookBlocked, true);
        assert.equal(state.fromCalls.includes('blocked_users'), true);
    });
});

test('comments list handler returns blocked-user queue rows from direct block state for the active view', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            guestbook_messages: [
                {
                    id: 'm1',
                    site: 'cn',
                    content: 'blocked message',
                    user_id: 'u1',
                    created_at: '2026-03-31T10:00:00.000Z',
                    image_url: null,
                    like_count: 0
                },
                {
                    id: 'm2',
                    site: 'cn',
                    content: 'normal message',
                    user_id: 'u2',
                    created_at: '2026-03-31T09:00:00.000Z',
                    image_url: null,
                    like_count: 0
                }
            ],
            profiles: [
                { id: 'u1', username: 'alice', avatar_url: null, email: 'alice@example.com' },
                { id: 'u2', username: 'bob', avatar_url: null, email: 'bob@example.com' }
            ],
            blocked_users: [
                { user_id: 'u1', scope: 'guestbook', reason: 'spam', expires_at: null }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=guestbook&site=cn&queue=blocked_user',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json().comments.map((comment) => comment.id), ['m1']);
        assert.equal(res.json().comments[0]?.user_block_state?.isGuestbookBlocked, true);
        assert.equal(res.json().comments[0]?.user_summary?.risk_level, 'blocked');
        assert.equal(state.fromCalls.includes('blocked_users'), true);
    });
});

test('comments list handler scopes the pending queue to unresolved and non-ignored items', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            guestbook_messages: [
                {
                    id: 'm1',
                    site: 'cn',
                    content: 'resolved row',
                    user_id: 'u1',
                    created_at: '2026-03-31T10:00:00.000Z'
                },
                {
                    id: 'm2',
                    site: 'cn',
                    content: 'ignored row',
                    user_id: 'u2',
                    created_at: '2026-03-31T10:01:00.000Z'
                },
                {
                    id: 'm3',
                    site: 'cn',
                    content: 'pending row',
                    user_id: 'u3',
                    created_at: '2026-03-31T10:02:00.000Z'
                }
            ],
            admin_comment_workflows: [
                {
                    id: 'wf1',
                    site: 'cn',
                    entity_type: 'guestbook_message',
                    entity_id: 'm1',
                    status: 'resolved',
                    priority: 'normal'
                },
                {
                    id: 'wf2',
                    site: 'cn',
                    entity_type: 'guestbook_message',
                    entity_id: 'm2',
                    status: 'ignored',
                    priority: 'normal'
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=guestbook&site=cn&queue=pending',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 1);
        assert.equal(res.json().comments[0].id, 'm3');
    });
});

test('comments list handler keeps resolved and ignored rows visible in the all queue', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            guestbook_messages: [
                {
                    id: 'm1',
                    site: 'cn',
                    content: 'resolved row',
                    user_id: 'u1',
                    created_at: '2026-03-31T10:00:00.000Z'
                },
                {
                    id: 'm2',
                    site: 'cn',
                    content: 'ignored row',
                    user_id: 'u2',
                    created_at: '2026-03-31T10:01:00.000Z'
                },
                {
                    id: 'm3',
                    site: 'cn',
                    content: 'pending row',
                    user_id: 'u3',
                    created_at: '2026-03-31T10:02:00.000Z'
                }
            ],
            admin_comment_workflows: [
                {
                    id: 'wf1',
                    site: 'cn',
                    entity_type: 'guestbook_message',
                    entity_id: 'm1',
                    status: 'resolved',
                    priority: 'normal'
                },
                {
                    id: 'wf2',
                    site: 'cn',
                    entity_type: 'guestbook_message',
                    entity_id: 'm2',
                    status: 'ignored',
                    priority: 'normal'
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=guestbook&site=cn&queue=all',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 3);
        assert.deepEqual(
            res.json().comments.map((comment) => comment.id),
            ['m3', 'm2', 'm1']
        );
    });
});

test('comments list handler returns gallery rows without relying on schema relationship aliases', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            prompt_comments: [
                {
                    id: 'g1',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: null,
                    content: 'gallery top comment',
                    user_id: 'u1',
                    created_at: '2026-03-31T11:00:00.000Z',
                    image_url: null,
                    is_pinned: true,
                    is_featured: false
                },
                {
                    id: 'g2',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: 'g1',
                    content: 'gallery reply',
                    user_id: 'u2',
                    created_at: '2026-03-31T11:05:00.000Z',
                    image_url: null,
                    is_pinned: false,
                    is_featured: true
                }
            ],
            profiles: [
                { id: 'u1', username: 'alice', avatar_url: null, email: 'alice@example.com' },
                { id: 'u2', username: 'bob', avatar_url: null, email: 'bob@example.com' }
            ],
            prompts: [
                { id: 'p1', title: 'Prompt One', title_zh: '提示词一', title_en: 'Prompt One' }
            ],
            comment_likes: [
                { id: 'like_1', site: 'cn', comment_id: 'g1', user_id: 'u9' },
                { id: 'like_2', site: 'cn', comment_id: 'g1', user_id: 'u8' },
                { id: 'like_3', site: 'cn', comment_id: 'g2', user_id: 'u7' }
            ],
            blocked_users: [
                { user_id: 'u2', scope: 'gallery', reason: 'spam', expires_at: null }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=gallery&site=cn',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 2);
        assert.equal(res.json().pagination.totalItems, 2);
        assert.equal(res.json().pagination.totalPages, 1);

        const [replyRow, topRow] = res.json().comments;
        assert.equal(replyRow.id, 'g2');
        assert.equal(replyRow.author, 'bob');
        assert.equal(replyRow.likes, 1);
        assert.equal(replyRow.prompt_title, 'Prompt One');
        assert.equal(replyRow.user_block_state?.isGalleryBlocked, true);
        assert.equal(replyRow.user_block_state?.hasGlobalBlock, false);

        assert.equal(topRow.id, 'g1');
        assert.equal(topRow.author, 'alice');
        assert.equal(topRow.reply_count, 1);
        assert.equal(topRow.likes, 2);
        assert.equal(topRow.is_pinned, true);
        assert.equal(topRow.user_block_state?.isGalleryBlocked, false);
    });
});

test('comments list handler can scope gallery moderation rows to a single prompt id', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            prompt_comments: [
                {
                    id: 'g1',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: null,
                    content: 'prompt one comment',
                    user_id: 'u1',
                    created_at: '2026-03-31T11:00:00.000Z',
                    image_url: null,
                    is_pinned: false,
                    is_featured: false
                },
                {
                    id: 'g2',
                    site: 'cn',
                    prompt_id: 'p2',
                    parent_id: null,
                    content: 'prompt two comment',
                    user_id: 'u2',
                    created_at: '2026-03-31T10:00:00.000Z',
                    image_url: null,
                    is_pinned: false,
                    is_featured: false
                }
            ],
            profiles: [
                { id: 'u1', username: 'alice', avatar_url: null, email: 'alice@example.com' },
                { id: 'u2', username: 'bob', avatar_url: null, email: 'bob@example.com' }
            ],
            prompts: [
                { id: 'p1', title: 'Prompt One', title_zh: '提示词一', title_en: 'Prompt One' },
                { id: 'p2', title: 'Prompt Two', title_zh: '提示词二', title_en: 'Prompt Two' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=gallery&site=cn&promptId=p2',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 1);
        assert.equal(res.json().pagination.totalItems, 1);
        assert.equal(res.json().comments[0]?.id, 'g2');
        assert.equal(res.json().comments[0]?.context, 'p2');
    });
});

test('comments list handler paginates guestbook moderation results without legacy truncation', async () => {
    const guestbookMessages = Array.from({ length: 55 }, (_, index) => ({
        id: `m${index + 1}`,
        site: 'cn',
        content: `message ${index + 1}`,
        user_id: `u${index + 1}`,
        created_at: new Date(Date.UTC(2026, 2, 31, 12, 0, 0) - index * 60 * 1000).toISOString(),
        image_url: null,
        like_count: index
    }));
    const profiles = guestbookMessages.map((message, index) => ({
        id: `u${index + 1}`,
        username: `user-${index + 1}`,
        avatar_url: null,
        email: `user-${index + 1}@example.com`
    }));

    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            guestbook_messages: guestbookMessages,
            profiles
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=guestbook&site=cn&page=2&pageSize=20',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 20);
        assert.equal(res.json().pagination.page, 2);
        assert.equal(res.json().pagination.pageSize, 20);
        assert.equal(res.json().pagination.totalItems, 55);
        assert.equal(res.json().pagination.totalPages, 3);
        assert.equal(res.json().comments[0]?.id, 'm21');
        assert.equal(res.json().comments.at(-1)?.id, 'm40');
    });
});

test('comments list handler applies search, type, and image filters server-side before pagination', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            prompt_comments: [
                {
                    id: 'g1',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: null,
                    content: 'gallery top comment',
                    user_id: 'u1',
                    created_at: '2026-03-31T11:00:00.000Z',
                    image_url: 'https://example.com/a.png',
                    is_pinned: true,
                    is_featured: false
                },
                {
                    id: 'g2',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: null,
                    content: 'plain top comment',
                    user_id: 'u2',
                    created_at: '2026-03-31T10:00:00.000Z',
                    image_url: null,
                    is_pinned: false,
                    is_featured: false
                },
                {
                    id: 'g3',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: 'g1',
                    content: 'reply comment',
                    user_id: 'u3',
                    created_at: '2026-03-31T09:00:00.000Z',
                    image_url: 'https://example.com/reply.png',
                    is_pinned: false,
                    is_featured: false
                }
            ],
            profiles: [
                { id: 'u1', username: 'alice', avatar_url: null, email: 'alice@example.com' },
                { id: 'u2', username: 'bob', avatar_url: null, email: 'bob@example.com' },
                { id: 'u3', username: 'carol', avatar_url: null, email: 'carol@example.com' }
            ],
            prompts: [
                { id: 'p1', title: 'Prompt One', title_zh: '提示词一', title_en: 'Prompt One' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=gallery&site=cn&search=%E7%BD%AE%E9%A1%B6&type=top&hasImage=1',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 1);
        assert.equal(res.json().pagination.totalItems, 1);
        assert.equal(res.json().comments[0]?.id, 'g1');
        assert.equal(res.json().comments[0]?.is_pinned, true);
        assert.equal(res.json().comments[0]?.image_url, 'https://example.com/a.png');
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
        assert.equal(res.json().deletedCount, 2);
        assert.equal(res.json().selectedCount, 1);
        assert.equal(res.json().cascadeDeletedCount, 1);
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

test('comments list handler attaches workflow state and user signals for V2 governance cards', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            prompt_comments: [
                {
                    id: 'g1',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: null,
                    content: 'need escalation',
                    user_id: 'u2',
                    created_at: '2026-03-31T11:00:00.000Z',
                    image_url: null,
                    is_pinned: false,
                    is_featured: false
                }
            ],
            profiles: [
                { id: 'u2', username: 'bob', avatar_url: null, email: 'bob@example.com' },
                { id: 'admin_9', username: 'ops', avatar_url: null, email: 'ops@example.com' }
            ],
            prompts: [
                { id: 'p1', title: 'Prompt One', title_zh: '提示词一', title_en: 'Prompt One' }
            ],
            admin_comment_workflows: [
                {
                    id: 'wf_1',
                    site: 'cn',
                    entity_type: 'prompt_comment',
                    entity_id: 'g1',
                    status: 'escalated',
                    priority: 'high',
                    assignee_id: 'admin_9',
                    assignee_label: '',
                    tags: ['risk', 'ticketed'],
                    note_count: 2,
                    linked_ticket_count: 1,
                    linked_ticket_ids: ['ticket_1'],
                    resolved_at: null,
                    updated_at: '2026-03-31T12:00:00.000Z',
                    last_activity_at: '2026-03-31T12:00:00.000Z',
                    metadata: {}
                }
            ],
            shop_tickets: [
                { id: 'ticket_1', user_id: 'u2', status: 'PENDING', created_at: '2026-03-31T12:00:00.000Z' }
            ],
            shop_orders: [
                { id: 'order_1', user_id: 'u2' }
            ],
            payment_orders: [
                { id: 'pay_1', user_id: 'u2' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=gallery&site=cn&queue=escalated',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 1);
        const row = res.json().comments[0];
        assert.equal(row.workflow.status, 'escalated');
        assert.equal(row.workflow.priority, 'high');
        assert.equal(row.workflow.assignee_label, 'ops@example.com');
        assert.deepEqual(row.workflow.tags, ['risk', 'ticketed']);
        assert.equal(row.user_summary.active_ticket_count, 1);
        assert.equal(row.user_summary.order_count, 1);
        assert.equal(row.user_summary.payment_order_count, 1);
    });
});

test('comments list handler excludes resolved ticketed comments from the escalated queue', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/list.js', {
        tables: {
            prompt_comments: [
                {
                    id: 'g-resolved-1',
                    site: 'cn',
                    prompt_id: 'p1',
                    parent_id: null,
                    content: 'ticket already handled',
                    user_id: 'u3',
                    created_at: '2026-04-01T11:00:00.000Z',
                    image_url: null,
                    is_pinned: false,
                    is_featured: false
                }
            ],
            profiles: [
                { id: 'u3', username: 'carol', avatar_url: null, email: 'carol@example.com' },
                { id: 'admin_9', username: 'ops', avatar_url: null, email: 'ops@example.com' }
            ],
            prompts: [
                { id: 'p1', title: 'Prompt One', title_zh: '提示词一', title_en: 'Prompt One' }
            ],
            admin_comment_workflows: [
                {
                    id: 'wf_resolved_1',
                    site: 'cn',
                    entity_type: 'prompt_comment',
                    entity_id: 'g-resolved-1',
                    status: 'resolved',
                    priority: 'normal',
                    assignee_id: 'admin_9',
                    assignee_label: '',
                    tags: ['ticketed'],
                    note_count: 1,
                    linked_ticket_count: 1,
                    linked_ticket_ids: ['ticket_resolved_1'],
                    resolved_at: '2026-04-01T12:00:00.000Z',
                    updated_at: '2026-04-01T12:00:00.000Z',
                    last_activity_at: '2026-04-01T12:00:00.000Z',
                    metadata: {}
                }
            ],
            shop_tickets: [
                { id: 'ticket_resolved_1', user_id: 'u3', status: 'RESOLVED', created_at: '2026-04-01T12:00:00.000Z' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/comments/list?view=gallery&site=cn&queue=escalated',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().comments.length, 0);
    });
});

test('comments workflow handler creates linked tickets and updates workflow state', async () => {
    await withCommentsHandler('../server/api-handlers/admin/comments/workflow.js', {
        tables: {
            profiles: [
                { id: 'admin_1', username: 'admin', avatar_url: null, email: 'admin@example.com' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'create_ticket',
                site: 'cn',
                entityType: 'prompt_comment',
                entityId: 'g1',
                comment: {
                    id: 'g1',
                    site: 'cn',
                    type: 'gallery',
                    entity_type: 'prompt_comment',
                    entity_label: '画廊评论',
                    user_id: 'user_1',
                    author: 'bob',
                    content: 'please help',
                    prompt_id: 'p1',
                    context_title: 'Prompt One',
                    root_snippet: 'top thread',
                    parent_snippet: ''
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.shop_tickets.length, 1);
        assert.equal(state.tables.admin_comment_workflows.length, 1);
        assert.equal(state.tables.admin_comment_workflows[0].status, 'escalated');
        assert.equal(state.tables.admin_comment_workflows[0].linked_ticket_count, 1);
        assert.equal(state.tables.admin_comment_ticket_links.length, 1);
        assert.equal(res.json().ticket_id, state.tables.shop_tickets[0].id);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'comments.ticket.create');
    });
});
